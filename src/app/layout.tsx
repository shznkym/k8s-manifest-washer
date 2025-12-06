import type { Metadata } from 'next'
import { Inter } from 'next/font/google'
import './globals.css'

const inter = Inter({ subsets: ['latin'] })

export const metadata: Metadata = {
    title: 'K8s Manifest Washer - Clean Your Kubernetes YAML',
    description: 'Transform dirty kubectl get -o yaml output into clean, deployable Kubernetes manifests. Remove unnecessary metadata, status, and managed fields instantly.',
    keywords: ['kubernetes', 'yaml', 'manifest', 'kubectl', 'devops', 'k8s'],
    authors: [{ name: 'K8s Manifest Washer' }],
    openGraph: {
        title: 'K8s Manifest Washer',
        description: 'Clean and optimize your Kubernetes YAML manifests',
        type: 'website',
    },
}

export default function RootLayout({
    children,
}: {
    children: React.ReactNode
}) {
    return (
        <html lang="en">
            <body className={inter.className}>{children}</body>
        </html>
    )
}
