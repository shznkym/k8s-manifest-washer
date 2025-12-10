'use client'

import { useState, useEffect } from 'react'
import yaml from 'js-yaml'

// Kubernetes versions with their OpenAPI spec URLs (using github raw content)
const K8S_VERSIONS = [
    { version: '1.31', label: 'v1.31 (Latest)', url: 'https://raw.githubusercontent.com/kubernetes/kubernetes/v1.31.0/api/openapi-spec/swagger.json' },
    { version: '1.30', label: 'v1.30', url: 'https://raw.githubusercontent.com/kubernetes/kubernetes/v1.30.0/api/openapi-spec/swagger.json' },
    { version: '1.29', label: 'v1.29', url: 'https://raw.githubusercontent.com/kubernetes/kubernetes/v1.29.0/api/openapi-spec/swagger.json' },
    { version: '1.28', label: 'v1.28', url: 'https://raw.githubusercontent.com/kubernetes/kubernetes/v1.28.0/api/openapi-spec/swagger.json' },
    { version: '1.27', label: 'v1.27', url: 'https://raw.githubusercontent.com/kubernetes/kubernetes/v1.27.0/api/openapi-spec/swagger.json' },
]

type CleaningMode = 'static' | 'dynamic'

interface OpenAPIDefinition {
    properties?: Record<string, any>
    description?: string
    required?: string[]
}

export default function Home() {
    const [inputYaml, setInputYaml] = useState('')
    const [outputYaml, setOutputYaml] = useState('')
    const [error, setError] = useState('')
    const [isProcessing, setIsProcessing] = useState(false)
    const [k8sVersion, setK8sVersion] = useState(K8S_VERSIONS[0])
    const [cleaningMode, setCleaningMode] = useState<CleaningMode>('static')
    const [openAPISpec, setOpenAPISpec] = useState<any>(null)
    const [isLoadingSpec, setIsLoadingSpec] = useState(false)
    const [specError, setSpecError] = useState('')

    // Fetch OpenAPI spec when version changes in dynamic mode
    useEffect(() => {
        if (cleaningMode === 'dynamic') {
            const fetchSpec = async () => {
                setIsLoadingSpec(true)
                setSpecError('')
                try {
                    const response = await fetch(k8sVersion.url)
                    if (!response.ok) throw new Error(`Failed to fetch spec: ${response.statusText}`)
                    const data = await response.json()
                    setOpenAPISpec(data)
                } catch (err) {
                    console.error('Error fetching spec:', err)
                    setSpecError('Failed to load Kubernetes spec. Using static rules as fallback.')
                } finally {
                    setIsLoadingSpec(false)
                }
            }
            fetchSpec()
        }
    }, [k8sVersion, cleaningMode])

    const getSystemFieldsFromSpec = (spec: any): string[] => {
        if (!spec || !spec.definitions || !spec.definitions['io.k8s.apimachinery.pkg.apis.meta.v1.ObjectMeta']) {
            return []
        }

        const metaDef = spec.definitions['io.k8s.apimachinery.pkg.apis.meta.v1.ObjectMeta']
        const systemFields: string[] = []

        if (metaDef.properties) {
            for (const [key, value] of Object.entries(metaDef.properties)) {
                const prop = value as any
                // Identify system fields based on readOnly flag or description
                if (prop.readOnly ||
                    ['uid', 'resourceVersion', 'generation', 'creationTimestamp', 'managedFields', 'selfLink', 'ownerReferences'].includes(key)) {
                    systemFields.push(key)
                }
            }
        }
        return systemFields
    }

    const cleanManifest = (obj: any, systemFields: string[] = []): any => {
        if (Array.isArray(obj)) {
            return obj.map(item => cleanManifest(item, systemFields))
        }

        if (obj !== null && typeof obj === 'object') {
            const cleaned: any = {}

            for (const [key, value] of Object.entries(obj)) {
                // Always skip status
                if (key === 'status') {
                    continue
                }

                // Handle metadata
                if (key === 'metadata' && typeof value === 'object' && value !== null) {
                    const cleanedMetadata: any = {}
                    const metadataObj = value as Record<string, any>

                    // Determine fields to remove based on mode
                    const fieldsToRemove = cleaningMode === 'dynamic' && systemFields.length > 0
                        ? [...systemFields, 'finalizers'] // Check OpenAPI fields + finalizers
                        : [
                            'uid', 'resourceVersion', 'generation', 'creationTimestamp',
                            'managedFields', 'finalizers', 'selfLink', 'ownerReferences'
                        ]

                    for (const [metaKey, metaValue] of Object.entries(metadataObj)) {
                        // Remove system fields
                        if (fieldsToRemove.includes(metaKey)) {
                            continue
                        }

                        // Special handling for annotations (always apply vendor cleaning logic)
                        if (metaKey === 'annotations' && typeof metaValue === 'object' && metaValue !== null) {
                            const cleanedAnnotations: any = {}
                            for (const [annoKey, annoValue] of Object.entries(metaValue)) {
                                if (
                                    annoKey === 'kubectl.kubernetes.io/last-applied-configuration' ||
                                    annoKey.startsWith('run.tanzu.vmware.com/') ||
                                    annoKey.startsWith('tkg.tanzu.vmware.com/')
                                ) {
                                    continue
                                }
                                cleanedAnnotations[annoKey] = annoValue
                            }
                            if (Object.keys(cleanedAnnotations).length > 0) {
                                cleanedMetadata[metaKey] = cleanedAnnotations
                            }
                        }
                        // Special handling for labels (always apply vendor cleaning logic)
                        else if (metaKey === 'labels' && typeof metaValue === 'object' && metaValue !== null) {
                            const cleanedLabels: any = {}
                            for (const [labelKey, labelValue] of Object.entries(metaValue)) {
                                if (
                                    labelKey.startsWith('topology.cluster.x-k8s.io/') ||
                                    labelKey.startsWith('run.tanzu.vmware.com/') ||
                                    labelKey.startsWith('addon.addons.kubernetes.vmware.com/')
                                ) {
                                    continue
                                }
                                cleanedLabels[labelKey] = labelValue
                            }
                            if (Object.keys(cleanedLabels).length > 0) {
                                cleanedMetadata[metaKey] = cleanedLabels
                            }
                        } else {
                            cleanedMetadata[metaKey] = cleanManifest(metaValue, systemFields)
                        }
                    }
                    cleaned[key] = cleanedMetadata
                }
                // Handle Spec (Specific CAPI/TKG cleaning rules - largely static but important)
                else if (key === 'spec' && typeof value === 'object' && value !== null) {
                    const cleanedSpec: any = {}
                    const specObj = value as Record<string, any>

                    for (const [specKey, specValue] of Object.entries(specObj)) {
                        // Vendor/CAPI specific fields to remove
                        if ([
                            'controlPlaneRef',
                            'infrastructureRef',
                            'controlPlaneEndpoint',
                        ].includes(specKey)) {
                            continue
                        }

                        // Recursively clean
                        const cleanedValue = cleanManifest(specValue, systemFields)

                        // Remove empty metadata from recursion result
                        if (specKey === 'metadata' && typeof cleanedValue === 'object' && cleanedValue !== null && Object.keys(cleanedValue).length === 0) {
                            continue
                        }

                        cleanedSpec[specKey] = cleanedValue
                    }
                    cleaned[key] = cleanedSpec
                } else {
                    const cleanedValue = cleanManifest(value, systemFields)

                    // Recursively remove empty metadata
                    if (key === 'metadata' && typeof cleanedValue === 'object' && cleanedValue !== null && Object.keys(cleanedValue).length === 0) {
                        continue
                    }

                    cleaned[key] = cleanedValue
                }
            }

            // Final pass: remove empty metadata at this level
            for (const [key, value] of Object.entries(cleaned)) {
                if (key === 'metadata' && typeof value === 'object' && value !== null && Object.keys(value).length === 0) {
                    delete cleaned[key]
                }
            }

            return cleaned
        }
        return obj
    }

    const handleWash = () => {
        setIsProcessing(true)
        setError('')
        setOutputYaml('')

        try {
            const docs = yaml.loadAll(inputYaml)

            // Expand "kind: List" documents into individual resources
            const expandedDocs = docs.flatMap((doc: any) => {
                if (doc && typeof doc === 'object' && doc.kind === 'List' && Array.isArray(doc.items)) {
                    return doc.items
                }
                return [doc]
            })

            // Get system fields from spec if in dynamic mode
            let systemFields: string[] = []
            if (cleaningMode === 'dynamic' && openAPISpec) {
                systemFields = getSystemFieldsFromSpec(openAPISpec)
                console.log('Dynamic System Fields:', systemFields)
            }

            const cleanedDocs = expandedDocs.map((doc: any) => cleanManifest(doc, systemFields))

            let result: string
            if (cleanedDocs.length === 1) {
                result = yaml.dump(cleanedDocs[0], { indent: 2, lineWidth: -1, noRefs: true })
            } else {
                result = cleanedDocs.map((doc: any) => yaml.dump(doc, { indent: 2, lineWidth: -1, noRefs: true })).join('---\n')
            }
            setOutputYaml(result)
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to parse YAML')
        } finally {
            setIsProcessing(false)
        }
    }

    const handleCopy = async () => {
        try {
            await navigator.clipboard.writeText(outputYaml)
        } catch (err) {
            console.error('Failed to copy:', err)
        }
    }

    return (
        <main className="min-h-screen p-8 animate-fade-in text-slate-200">
            <div className="max-w-7xl mx-auto">
                <header className="text-center mb-10 animate-slide-up">
                    <h1 className="text-5xl font-bold mb-4 bg-gradient-to-r from-primary-400 to-primary-600 bg-clip-text text-transparent">
                        K8s Manifest Washer <span className="text-sm font-normal text-slate-400 block mt-2">v2.0 - Dynamic Spec Support</span>
                    </h1>
                    <p className="text-slate-400 text-lg">
                        Smartly clean Kubernetes manifests using standard spec definitions
                    </p>
                </header>

                {/* Controls Section */}
                <div className="config-card">
                    <h2 className="config-header">
                        <svg className="text-primary-400" width="20" height="20" style={{ minWidth: '20px', minHeight: '20px' }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6V4m0 2a2 2 0 100 4m0-4a2 2 0 110 4m-6 8a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4m6 6v10m6-2a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4" />
                        </svg>
                        Configuration
                    </h2>

                    <div className="config-grid">
                        {/* Mode Selection */}
                        <div className="config-col">
                            <label className="label-text">Cleaning Strategy</label>
                            <div className="mode-grid">
                                <div
                                    onClick={() => setCleaningMode('static')}
                                    className={`card-option ${cleaningMode === 'static' ? 'active' : ''}`}
                                >
                                    <div className="card-option-header">
                                        <span className={`card-title ${cleaningMode === 'static' ? 'text-white' : 'text-slate-200'}`}>
                                            Default (Static)
                                        </span>
                                        {cleaningMode === 'static' && (
                                            <span className="active-indicator">
                                                <span className="ping-animation"></span>
                                                <span className="dot"></span>
                                            </span>
                                        )}
                                    </div>
                                    <p className="card-desc">
                                        Fast & reliable. Removes standard identified system fields. Recommended for most cases.
                                    </p>
                                </div>

                                <div
                                    onClick={() => setCleaningMode('dynamic')}
                                    className={`card-option ${cleaningMode === 'dynamic' ? 'active' : ''}`}
                                >
                                    <div className="card-option-header">
                                        <span className={`card-title ${cleaningMode === 'dynamic' ? 'text-white' : 'text-slate-200'}`}>
                                            Dynamic (OpenAPI)
                                        </span>
                                        {cleaningMode === 'dynamic' && (
                                            <span className="active-indicator">
                                                <span className="ping-animation"></span>
                                                <span className="dot"></span>
                                            </span>
                                        )}
                                    </div>
                                    <p className="card-desc">
                                        Fetches official K8s OpenAPI Spec to identify system fields. More accurate for specific versions.
                                    </p>
                                </div>
                            </div>
                        </div>

                        {/* Version Selection (Only visible in Dynamic Mode) */}
                        <div className={`config-col transition-opacity duration-300 ${cleaningMode === 'dynamic' ? 'opacity-100' : 'opacity-40 pointer-events-none grayscale'}`}>
                            <label className="label-text">
                                <span>Target Kubernetes Version {cleaningMode !== 'dynamic' && <span className="text-xs text-slate-500">(Requires Dynamic Mode)</span>}</span>
                                {isLoadingSpec && <span className="badge-loading flex items-center gap-1">⚡ Loading Spec...</span>}
                                {!isLoadingSpec && !specError && openAPISpec && cleaningMode === 'dynamic' && <span className="badge-success flex items-center gap-1">✅ Spec Loaded</span>}
                                {specError && <span className="badge-error flex items-center gap-1">⚠️ Error</span>}
                            </label>

                            <div className="select-wrapper">
                                <select
                                    value={k8sVersion.version}
                                    onChange={(e) => setK8sVersion(K8S_VERSIONS.find(v => v.version === e.target.value) || K8S_VERSIONS[0])}
                                    disabled={cleaningMode !== 'dynamic'}
                                    className="select-custom"
                                >
                                    {K8S_VERSIONS.map((v) => (
                                        <option key={v.version} value={v.version}>{v.label}</option>
                                    ))}
                                </select>
                                <div className="select-icon">
                                    <svg className="h-5 w-5" width="20" height="20" style={{ minWidth: '20px', minHeight: '20px' }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                                    </svg>
                                </div>
                            </div>

                            {specError && (
                                <p className="mt-2 text-xs text-red-400 bg-red-500/10 p-2 rounded border border-red-500/20">
                                    {specError}
                                </p>
                            )}
                        </div>
                    </div>
                </div>

                <div className="main-layout">
                    {/* Input */}
                    <div className="editor-card animate-slide-up" style={{ animationDelay: '0.1s' }}>
                        <div className="editor-header">
                            <h2 className="editor-title">
                                <span className="dot-pulse bg-red" />
                                Dirty YAML
                            </h2>
                            <button onClick={() => setInputYaml('')} className="text-btn">Clear</button>
                        </div>
                        <textarea
                            value={inputYaml}
                            onChange={e => setInputYaml(e.target.value)}
                            placeholder="Paste dirty YAML here..."
                            className="textarea-custom flex-1"
                        />
                    </div>

                    {/* Action */}
                    <div className="action-container">
                        <button onClick={handleWash} disabled={!inputYaml || isProcessing || (cleaningMode === 'dynamic' && isLoadingSpec)} className="btn-primary whitespace-nowrap">
                            {isProcessing ? (
                                <span className="flex items-center gap-2">
                                    <svg className="animate-spin" width="20" height="20" style={{ minWidth: '20px', minHeight: '20px' }} viewBox="0 0 24 24">
                                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                                    </svg>
                                    Processing...
                                </span>
                            ) : (
                                <span className="flex items-center gap-2">
                                    <svg width="20" height="20" style={{ minWidth: '20px', minHeight: '20px' }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                                    </svg>
                                    Wash & Minify
                                </span>
                            )}
                        </button>
                    </div>

                    {/* Output */}
                    <div className="editor-card animate-slide-up" style={{ animationDelay: '0.3s' }}>
                        <div className="editor-header">
                            <h2 className="editor-title">
                                <span className="dot-pulse bg-green" />
                                Clean YAML
                            </h2>
                            {outputYaml && (
                                <button onClick={handleCopy} className="text-btn text-btn-primary">
                                    <svg width="16" height="16" style={{ minWidth: '16px', minHeight: '16px' }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                                    </svg>
                                    Copy
                                </button>
                            )}
                        </div>
                        {error ? (
                            <div className="flex-1 flex items-center justify-center text-center">
                                <div><div className="text-4xl mb-4">⚠️</div><p className="text-red-400">{error}</p></div>
                            </div>
                        ) : (
                            <textarea
                                value={outputYaml}
                                readOnly
                                placeholder="Clean YAML appears here..."
                                className="textarea-custom flex-1"
                            />
                        )}
                    </div>
                </div>
            </div>
        </main>
    )
}
