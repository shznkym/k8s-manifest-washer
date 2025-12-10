import { NextRequest, NextResponse } from 'next/server'
import yaml from 'js-yaml'
import https from 'https'

type AuthType = 'token' | 'certificate'

interface SmartCleanRequest {
    manifest: string
    clusterUrl: string
    authType: AuthType
    token?: string
    clientCert?: string
    clientKey?: string
}

interface CleanResult {
    cleanedManifest: string
    removedFields: string[]
    errors: string[]
}

// Fields that are always system-generated (Kubernetes core)
const ALWAYS_REMOVE_METADATA = [
    'uid',
    'resourceVersion',
    'creationTimestamp',
    'generation',
    'managedFields',
    'selfLink',
]

// Annotation prefixes that are system-generated
const SYSTEM_ANNOTATION_PREFIXES = [
    'kubectl.kubernetes.io/',
    'deployment.kubernetes.io/',
]

// Label prefixes that are system-generated
const SYSTEM_LABEL_PREFIXES = [
    'topology.cluster.x-k8s.io/',
]

function createHttpsAgent(authType: AuthType, clientCert?: string, clientKey?: string): https.Agent {
    const options: https.AgentOptions = {
        rejectUnauthorized: false, // Skip TLS verification for self-signed certs
    }

    if (authType === 'certificate' && clientCert && clientKey) {
        options.cert = clientCert
        options.key = clientKey
    }

    return new https.Agent(options)
}

async function testFieldRemoval(
    manifest: any,
    clusterUrl: string,
    authType: AuthType,
    token?: string,
    clientCert?: string,
    clientKey?: string,
    fieldPath?: string[]
): Promise<boolean> {
    if (!fieldPath) return false

    // Create a deep copy and remove the field
    const testManifest = JSON.parse(JSON.stringify(manifest))

    let current = testManifest
    for (let i = 0; i < fieldPath.length - 1; i++) {
        if (!current[fieldPath[i]]) return true // Field doesn't exist, safe to remove
        current = current[fieldPath[i]]
    }

    const lastKey = fieldPath[fieldPath.length - 1]
    if (!(lastKey in current)) return true // Field doesn't exist

    delete current[lastKey]

    // Build API URL for dry-run
    const apiVersion = testManifest.apiVersion || 'v1'
    const kind = testManifest.kind?.toLowerCase() + 's' || 'resources'
    const namespace = testManifest.metadata?.namespace
    const name = testManifest.metadata?.name

    // Determine API path
    let apiPath: string
    if (apiVersion.includes('/')) {
        // Custom resource (e.g., cluster.x-k8s.io/v1beta2)
        const [group, version] = apiVersion.split('/')
        if (namespace) {
            apiPath = `/apis/${group}/${version}/namespaces/${namespace}/${kind}/${name}?dryRun=All`
        } else {
            apiPath = `/apis/${group}/${version}/${kind}/${name}?dryRun=All`
        }
    } else {
        // Core resource (e.g., v1)
        if (namespace) {
            apiPath = `/api/${apiVersion}/namespaces/${namespace}/${kind}/${name}?dryRun=All`
        } else {
            apiPath = `/api/${apiVersion}/${kind}/${name}?dryRun=All`
        }
    }

    try {
        const headers: Record<string, string> = {
            'Content-Type': 'application/yaml',
        }

        if (authType === 'token' && token) {
            headers['Authorization'] = `Bearer ${token}`
        }

        const agent = createHttpsAgent(authType, clientCert, clientKey)

        const response = await fetch(`${clusterUrl}${apiPath}`, {
            method: 'PUT',
            headers,
            body: yaml.dump(testManifest),
            // @ts-ignore - Node.js specific option
            agent,
        })

        if (response.ok || response.status === 200 || response.status === 201) {
            return true // Field can be safely removed
        }

        // Check if error is about the removed field
        const errorBody = await response.text()
        if (errorBody.includes('required') || errorBody.includes('missing')) {
            return false // Field is required
        }

        return true // Other errors, assume field is removable
    } catch (error) {
        console.error(`Error testing field ${fieldPath.join('.')}:`, error)
        return false // On error, keep the field
    }
}

function getAllFieldPaths(obj: any, prefix: string[] = []): string[][] {
    const paths: string[][] = []

    if (obj && typeof obj === 'object' && !Array.isArray(obj)) {
        for (const key of Object.keys(obj)) {
            const currentPath = [...prefix, key]
            paths.push(currentPath)

            // Recurse into objects (but not arrays)
            if (typeof obj[key] === 'object' && obj[key] !== null && !Array.isArray(obj[key])) {
                paths.push(...getAllFieldPaths(obj[key], currentPath))
            }
        }
    }

    return paths
}

async function smartClean(
    manifest: any,
    clusterUrl: string,
    authType: AuthType,
    token?: string,
    clientCert?: string,
    clientKey?: string
): Promise<{ cleaned: any; removedFields: string[] }> {
    const removedFields: string[] = []
    const cleaned = JSON.parse(JSON.stringify(manifest))

    // Level 1: Always remove these (Kubernetes core rules)
    if (cleaned.metadata) {
        for (const field of ALWAYS_REMOVE_METADATA) {
            if (field in cleaned.metadata) {
                delete cleaned.metadata[field]
                removedFields.push(`metadata.${field}`)
            }
        }

        // Clean annotations by prefix
        if (cleaned.metadata.annotations) {
            const annotationsToRemove: string[] = []
            for (const key of Object.keys(cleaned.metadata.annotations)) {
                if (SYSTEM_ANNOTATION_PREFIXES.some(prefix => key.startsWith(prefix))) {
                    annotationsToRemove.push(key)
                }
            }
            for (const key of annotationsToRemove) {
                delete cleaned.metadata.annotations[key]
                removedFields.push(`metadata.annotations.${key}`)
            }
            if (Object.keys(cleaned.metadata.annotations).length === 0) {
                delete cleaned.metadata.annotations
            }
        }

        // Clean labels by prefix
        if (cleaned.metadata.labels) {
            const labelsToRemove: string[] = []
            for (const key of Object.keys(cleaned.metadata.labels)) {
                if (SYSTEM_LABEL_PREFIXES.some(prefix => key.startsWith(prefix))) {
                    labelsToRemove.push(key)
                }
            }
            for (const key of labelsToRemove) {
                delete cleaned.metadata.labels[key]
                removedFields.push(`metadata.labels.${key}`)
            }
        }

        // Remove finalizers
        if (cleaned.metadata.finalizers) {
            delete cleaned.metadata.finalizers
            removedFields.push('metadata.finalizers')
        }
    }

    // Always remove status
    if (cleaned.status) {
        delete cleaned.status
        removedFields.push('status')
    }

    // Level 3: Test spec fields with dry-run (only if we have valid auth)
    const hasValidAuth = (authType === 'token' && token) || (authType === 'certificate' && clientCert && clientKey)
    if (cleaned.spec && clusterUrl && hasValidAuth) {
        const specFields = Object.keys(cleaned.spec)

        for (const field of specFields) {
            // Skip topology as it's always user-defined
            if (field === 'topology' || field === 'clusterNetwork') {
                continue
            }

            const canRemove = await testFieldRemoval(cleaned, clusterUrl, authType, token, clientCert, clientKey, ['spec', field])
            if (canRemove) {
                delete cleaned.spec[field]
                removedFields.push(`spec.${field}`)
            }
        }
    }

    return { cleaned, removedFields }
}

export async function POST(request: NextRequest) {
    try {
        const body: SmartCleanRequest = await request.json()

        if (!body.manifest) {
            return NextResponse.json(
                { error: 'Manifest is required' },
                { status: 400 }
            )
        }

        // Default authType to 'token' if not specified
        const authType: AuthType = (body.authType === 'certificate' ? 'certificate' : 'token')

        // Parse YAML (handle multi-document)
        const docs = yaml.loadAll(body.manifest)

        const results: any[] = []
        const allRemovedFields: string[] = []
        const errors: string[] = []

        for (const doc of docs) {
            if (!doc || typeof doc !== 'object') continue

            try {
                const { cleaned, removedFields } = await smartClean(
                    doc,
                    body.clusterUrl,
                    authType,
                    body.token,
                    body.clientCert,
                    body.clientKey
                )
                results.push(cleaned)
                allRemovedFields.push(...removedFields)
            } catch (err) {
                errors.push(`Error processing document: ${err}`)
                results.push(doc)
            }
        }

        // Convert back to YAML
        let cleanedManifest: string
        if (results.length === 1) {
            cleanedManifest = yaml.dump(results[0], { indent: 2, lineWidth: -1, noRefs: true })
        } else {
            cleanedManifest = results
                .map(doc => yaml.dump(doc, { indent: 2, lineWidth: -1, noRefs: true }))
                .join('---\n')
        }

        const response: CleanResult = {
            cleanedManifest,
            removedFields: [...new Set(allRemovedFields)], // Dedupe
            errors,
        }

        return NextResponse.json(response)
    } catch (error) {
        console.error('Smart clean error:', error)
        return NextResponse.json(
            { error: `Failed to process manifest: ${error}` },
            { status: 500 }
        )
    }
}
