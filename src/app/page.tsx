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

            // Get system fields from spec if in dynamic mode
            let systemFields: string[] = []
            if (cleaningMode === 'dynamic' && openAPISpec) {
                systemFields = getSystemFieldsFromSpec(openAPISpec)
                console.log('Dynamic System Fields:', systemFields)
            }

            const cleanedDocs = docs.map(doc => cleanManifest(doc, systemFields))

            let result: string
            if (cleanedDocs.length === 1) {
                result = yaml.dump(cleanedDocs[0], { indent: 2, lineWidth: -1, noRefs: true })
            } else {
                result = cleanedDocs.map(doc => yaml.dump(doc, { indent: 2, lineWidth: -1, noRefs: true })).join('---\n')
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
                <div className="glass-effect rounded-2xl p-6 mb-10 animate-slide-up" style={{ animationDelay: '0.1s' }}>
                    <h2 className="text-xl font-semibold text-slate-200 mb-4 flex items-center gap-2">
                        <svg className="w-5 h-5 text-primary-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6V4m0 2a2 2 0 100 4m0-4a2 2 0 110 4m-6 8a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4m6 6v10m6-2a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4" />
                        </svg>
                        Configuration
                    </h2>

                    <div className="flex flex-col md:flex-row gap-8">
                        {/* Mode Selection */}
                        <div className="flex-1">
                            <label className="text-sm font-medium text-slate-400 mb-3 block">Cleaning Strategy</label>
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                <button
                                    onClick={() => setCleaningMode('static')}
                                    className={`relative p-4 rounded-xl border-2 text-left transition-all duration-200 group ${cleaningMode === 'static'
                                            ? 'border-primary-500 bg-primary-500/10 shadow-[0_0_20px_rgba(139,92,246,0.3)]'
                                            : 'border-slate-700 bg-slate-800/50 hover:border-slate-600 hover:bg-slate-800'
                                        }`}
                                >
                                    <div className="flex items-center justify-between mb-1">
                                        <span className={`text-base font-bold ${cleaningMode === 'static' ? 'text-white' : 'text-slate-200'}`}>
                                            Default (Static)
                                        </span>
                                        {cleaningMode === 'static' && (
                                            <span className="flex h-3 w-3 relative">
                                                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary-400 opacity-75"></span>
                                                <span className="relative inline-flex rounded-full h-3 w-3 bg-primary-500"></span>
                                            </span>
                                        )}
                                    </div>
                                    <p className="text-xs text-slate-400 leading-relaxed">
                                        Fast & reliable. Removes standard identified system fields. Recommended for most cases.
                                    </p>
                                </button>

                                <button
                                    onClick={() => setCleaningMode('dynamic')}
                                    className={`relative p-4 rounded-xl border-2 text-left transition-all duration-200 group ${cleaningMode === 'dynamic'
                                            ? 'border-primary-500 bg-primary-500/10 shadow-[0_0_20px_rgba(139,92,246,0.3)]'
                                            : 'border-slate-700 bg-slate-800/50 hover:border-slate-600 hover:bg-slate-800'
                                        }`}
                                >
                                    <div className="flex items-center justify-between mb-1">
                                        <span className={`text-base font-bold ${cleaningMode === 'dynamic' ? 'text-white' : 'text-slate-200'}`}>
                                            Dynamic (OpenAPI)
                                        </span>
                                        {cleaningMode === 'dynamic' && (
                                            <span className="flex h-3 w-3 relative">
                                                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary-400 opacity-75"></span>
                                                <span className="relative inline-flex rounded-full h-3 w-3 bg-primary-500"></span>
                                            </span>
                                        )}
                                    </div>
                                    <p className="text-xs text-slate-400 leading-relaxed">
                                        Fetches official K8s OpenAPI Spec to identify system fields. More accurate for specific versions.
                                    </p>
                                </button>
                            </div>
                        </div>

                        {/* Version Selection (Only visible in Dynamic Mode) */}
                        <div className={`transition-all duration-300 ${cleaningMode === 'dynamic' ? 'opacity-100 flex-1' : 'opacity-40 pointer-events-none flex-1 grayscale'}`}>
                            <label className="text-sm font-medium text-slate-400 mb-3 block flex items-center justify-between">
                                Target Kubernetes Version {cleaningMode !== 'dynamic' && <span className="text-xs text-slate-500">(Requires Dynamic Mode)</span>}
                                {isLoadingSpec && <span className="text-xs text-yellow-400 animate-pulse flex items-center gap-1">⚡ Loading Spec...</span>}
                                {!isLoadingSpec && !specError && openAPISpec && cleaningMode === 'dynamic' && <span className="text-xs text-green-400 flex items-center gap-1">✅ Spec Loaded</span>}
                                {specError && <span className="text-xs text-red-400 flex items-center gap-1">⚠️ Error</span>}
                            </label>

                            <div className="relative">
                                <select
                                    value={k8sVersion.version}
                                    onChange={(e) => setK8sVersion(K8S_VERSIONS.find(v => v.version === e.target.value) || K8S_VERSIONS[0])}
                                    disabled={cleaningMode !== 'dynamic'}
                                    className="w-full appearance-none bg-slate-800 border-2 border-slate-700 text-slate-200 text-sm rounded-xl focus:ring-2 focus:ring-primary-500 focus:border-primary-500 block p-4 pr-10 hover:border-slate-600 transition-colors cursor-pointer disabled:cursor-not-allowed"
                                >
                                    {K8S_VERSIONS.map((v) => (
                                        <option key={v.version} value={v.version}>{v.label}</option>
                                    ))}
                                </select>
                                <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-4 text-slate-400">
                                    <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
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

                <div className="grid grid-cols-1 lg:grid-cols-[1fr_auto_1fr] gap-6 items-start">
                    {/* Input */}
                    <div className="glass-effect rounded-2xl p-6 h-[600px] flex flex-col animate-slide-up delay-100">
                        <div className="flex justify-between mb-4">
                            <h2 className="text-xl font-semibold flex items-center gap-2"><span className="w-2 h-2 bg-red-500 rounded-full animate-pulse" /> Dirty YAML</h2>
                            <button onClick={() => setInputYaml('')} className="text-sm text-slate-400 hover:text-white">Clear</button>
                        </div>
                        <textarea value={inputYaml} onChange={e => setInputYaml(e.target.value)} placeholder="Paste dirty YAML here..." className="textarea-custom flex-1" />
                    </div>

                    {/* Action */}
                    <div className="flex items-center justify-center lg:h-[600px] animate-slide-up delay-200">
                        <button onClick={handleWash} disabled={!inputYaml || isProcessing || (cleaningMode === 'dynamic' && isLoadingSpec)} className="btn-primary whitespace-nowrap">
                            {isProcessing ? 'Processing...' : 'Wash & Minify'}
                        </button>
                    </div>

                    {/* Output */}
                    <div className="glass-effect rounded-2xl p-6 h-[600px] flex flex-col animate-slide-up delay-300">
                        <div className="flex justify-between mb-4">
                            <h2 className="text-xl font-semibold flex items-center gap-2"><span className="w-2 h-2 bg-green-500 rounded-full animate-pulse" /> Clean YAML</h2>
                            {outputYaml && <button onClick={handleCopy} className="text-sm text-primary-400 hover:text-primary-300 flex items-center gap-1">Copy</button>}
                        </div>
                        {error ? (
                            <div className="flex-1 flex items-center justify-center text-center">
                                <div><div className="text-4xl mb-4">⚠️</div><p className="text-red-400">{error}</p></div>
                            </div>
                        ) : (
                            <textarea value={outputYaml} readOnly placeholder="Clean YAML appears here..." className="textarea-custom flex-1" />
                        )}
                    </div>
                </div>
            </div>
        </main>
    )
}
