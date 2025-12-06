'use client'

import { useState } from 'react'
import yaml from 'js-yaml'

export default function Home() {
    const [inputYaml, setInputYaml] = useState('')
    const [outputYaml, setOutputYaml] = useState('')
    const [error, setError] = useState('')
    const [isProcessing, setIsProcessing] = useState(false)

    const cleanManifest = (obj: any): any => {
        if (Array.isArray(obj)) {
            return obj.map(cleanManifest)
        }

        if (obj !== null && typeof obj === 'object') {
            const cleaned: any = {}

            for (const [key, value] of Object.entries(obj)) {
                // Skip status entirely
                if (key === 'status') {
                    continue
                }

                // Handle metadata specially
                if (key === 'metadata' && typeof value === 'object' && value !== null) {
                    const cleanedMetadata: any = {}
                    const metadataObj = value as Record<string, any>

                    for (const [metaKey, metaValue] of Object.entries(metadataObj)) {
                        // Remove unwanted metadata fields
                        if ([
                            'uid',
                            'resourceVersion',
                            'generation',
                            'creationTimestamp',
                            'managedFields',
                            'finalizers', // Remove finalizers (usually auto-managed)
                        ].includes(metaKey)) {
                            continue
                        }

                        // Handle annotations specially
                        if (metaKey === 'annotations' && typeof metaValue === 'object' && metaValue !== null) {
                            const cleanedAnnotations: any = {}
                            for (const [annoKey, annoValue] of Object.entries(metaValue)) {
                                // Skip auto-generated annotations
                                if (
                                    annoKey === 'kubectl.kubernetes.io/last-applied-configuration' ||
                                    annoKey.startsWith('run.tanzu.vmware.com/') ||
                                    annoKey.startsWith('tkg.tanzu.vmware.com/')
                                ) {
                                    continue
                                }
                                cleanedAnnotations[annoKey] = annoValue
                            }
                            // Only add annotations if there are any left
                            if (Object.keys(cleanedAnnotations).length > 0) {
                                cleanedMetadata[metaKey] = cleanedAnnotations
                            }
                        } else if (metaKey === 'labels' && typeof metaValue === 'object' && metaValue !== null) {
                            // Handle labels specially - remove auto-generated ones
                            const cleanedLabels: any = {}
                            for (const [labelKey, labelValue] of Object.entries(metaValue)) {
                                // Skip auto-generated labels
                                if (
                                    labelKey.startsWith('topology.cluster.x-k8s.io/') ||
                                    labelKey.startsWith('run.tanzu.vmware.com/') ||
                                    labelKey.startsWith('addon.addons.kubernetes.vmware.com/')
                                ) {
                                    continue
                                }
                                cleanedLabels[labelKey] = labelValue
                            }
                            // Only add labels if there are any left
                            if (Object.keys(cleanedLabels).length > 0) {
                                cleanedMetadata[metaKey] = cleanedLabels
                            }
                        } else {
                            cleanedMetadata[metaKey] = cleanManifest(metaValue)
                        }
                    }

                    cleaned[key] = cleanedMetadata
                } else if (key === 'spec' && typeof value === 'object' && value !== null) {
                    // Handle spec specially - remove Ref fields and controlPlaneEndpoint
                    const cleanedSpec: any = {}
                    const specObj = value as Record<string, any>

                    for (const [specKey, specValue] of Object.entries(specObj)) {
                        // Skip auto-generated Ref fields and controlPlaneEndpoint
                        if ([
                            'controlPlaneRef',
                            'infrastructureRef',
                            'controlPlaneEndpoint',
                        ].includes(specKey)) {
                            continue
                        }

                        // Recursively clean nested objects, but remove empty metadata
                        const cleanedValue = cleanManifest(specValue)

                        // Skip empty metadata objects
                        cleanedSpec[specKey] = cleanedValue
                    }

                    cleaned[key] = cleanedSpec
                } else {
                    // Recursively clean all other values
                    const cleanedValue = cleanManifest(value)

                    // Skip empty metadata objects at any level
                    if (key === 'metadata' && typeof cleanedValue === 'object' && cleanedValue !== null && Object.keys(cleanedValue).length === 0) {
                        continue
                    }

                    cleaned[key] = cleanedValue
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
            // Parse YAML (supports both single and multi-document)
            const docs = yaml.loadAll(inputYaml)

            // Clean each document
            const cleanedDocs = docs.map(cleanManifest)

            // Convert back to YAML
            let result: string
            if (cleanedDocs.length === 1) {
                result = yaml.dump(cleanedDocs[0], {
                    indent: 2,
                    lineWidth: -1,
                    noRefs: true,
                })
            } else {
                result = cleanedDocs
                    .map((doc) =>
                        yaml.dump(doc, {
                            indent: 2,
                            lineWidth: -1,
                            noRefs: true,
                        })
                    )
                    .join('---\n')
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
            // You could add a toast notification here
        } catch (err) {
            console.error('Failed to copy:', err)
        }
    }

    return (
        <main className="min-h-screen p-8 animate-fade-in">
            <div className="max-w-7xl mx-auto">
                {/* Header */}
                <header className="text-center mb-12 animate-slide-up">
                    <h1 className="text-5xl font-bold mb-4 bg-gradient-to-r from-primary-400 to-primary-600 bg-clip-text text-transparent">
                        K8s Manifest Washer
                    </h1>
                    <p className="text-slate-400 text-lg">
                        Transform dirty <code className="px-2 py-1 bg-slate-800 rounded text-primary-400">kubectl get -o yaml</code> output into clean, deployable manifests
                    </p>
                </header>

                {/* Main Content */}
                <div className="grid grid-cols-1 lg:grid-cols-[1fr_auto_1fr] gap-6 items-start">
                    {/* Input Section */}
                    <div className="glass-effect rounded-2xl p-6 h-[600px] flex flex-col animate-slide-up" style={{ animationDelay: '0.1s' }}>
                        <div className="flex items-center justify-between mb-4">
                            <h2 className="text-xl font-semibold text-slate-200 flex items-center gap-2">
                                <span className="w-2 h-2 bg-red-500 rounded-full animate-pulse"></span>
                                Dirty YAML
                            </h2>
                            <button
                                onClick={() => setInputYaml('')}
                                className="text-sm text-slate-400 hover:text-slate-200 transition-colors"
                            >
                                Clear
                            </button>
                        </div>
                        <textarea
                            value={inputYaml}
                            onChange={(e) => setInputYaml(e.target.value)}
                            placeholder="Paste your dirty YAML here..."
                            className="textarea-custom flex-1"
                        />
                    </div>

                    {/* Action Button */}
                    <div className="flex items-center justify-center lg:h-[600px] animate-slide-up" style={{ animationDelay: '0.2s' }}>
                        <button
                            onClick={handleWash}
                            disabled={!inputYaml || isProcessing}
                            className="btn-primary disabled:opacity-50 disabled:cursor-not-allowed disabled:transform-none whitespace-nowrap"
                        >
                            {isProcessing ? (
                                <span className="flex items-center gap-2">
                                    <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24">
                                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                                    </svg>
                                    Processing...
                                </span>
                            ) : (
                                <span className="flex items-center gap-2">
                                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                                    </svg>
                                    Wash & Minify
                                </span>
                            )}
                        </button>
                    </div>

                    {/* Output Section */}
                    <div className="glass-effect rounded-2xl p-6 h-[600px] flex flex-col animate-slide-up" style={{ animationDelay: '0.3s' }}>
                        <div className="flex items-center justify-between mb-4">
                            <h2 className="text-xl font-semibold text-slate-200 flex items-center gap-2">
                                <span className="w-2 h-2 bg-green-500 rounded-full animate-pulse"></span>
                                Clean YAML
                            </h2>
                            {outputYaml && (
                                <button
                                    onClick={handleCopy}
                                    className="text-sm text-primary-400 hover:text-primary-300 transition-colors flex items-center gap-1"
                                >
                                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                                    </svg>
                                    Copy
                                </button>
                            )}
                        </div>
                        {error ? (
                            <div className="flex-1 flex items-center justify-center">
                                <div className="text-center">
                                    <div className="text-red-400 text-4xl mb-4">⚠️</div>
                                    <p className="text-red-400 font-semibold mb-2">Error parsing YAML</p>
                                    <p className="text-slate-400 text-sm">{error}</p>
                                </div>
                            </div>
                        ) : (
                            <textarea
                                value={outputYaml}
                                readOnly
                                placeholder="Clean YAML will appear here..."
                                className="textarea-custom flex-1"
                            />
                        )}
                    </div>
                </div>

                {/* Info Section */}
                <div className="mt-12 glass-effect rounded-2xl p-6 animate-slide-up" style={{ animationDelay: '0.4s' }}>
                    <h3 className="text-lg font-semibold text-slate-200 mb-4">What gets removed?</h3>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm text-slate-400">
                        <div>
                            <h4 className="font-semibold text-primary-400 mb-2">Metadata fields:</h4>
                            <ul className="space-y-1 list-disc list-inside">
                                <li><code className="text-slate-300">uid</code></li>
                                <li><code className="text-slate-300">resourceVersion</code></li>
                                <li><code className="text-slate-300">generation</code></li>
                                <li><code className="text-slate-300">creationTimestamp</code></li>
                                <li><code className="text-slate-300">managedFields</code></li>
                            </ul>
                        </div>
                        <div>
                            <h4 className="font-semibold text-primary-400 mb-2">Other fields:</h4>
                            <ul className="space-y-1 list-disc list-inside">
                                <li>Entire <code className="text-slate-300">status</code> block</li>
                                <li><code className="text-slate-300">kubectl.kubernetes.io/last-applied-configuration</code> annotation</li>
                            </ul>
                        </div>
                    </div>
                </div>

                {/* Footer */}
                <footer className="mt-8 text-center text-slate-500 text-sm">
                    <p>Built with Next.js, TypeScript, and Tailwind CSS</p>
                </footer>
            </div>
        </main>
    )
}
