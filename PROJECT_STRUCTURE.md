# K8s Manifest Washer - Project Structure

```
k8s-manifest-washer/
├── .github/
│   └── workflows/
│       └── build-push.yaml          # GitHub Actions CI/CD workflow
│
├── k8s/                             # Kubernetes manifests
│   ├── create-ghcr-secret.sh        # Helper script for GHCR secret
│   ├── deployment.yaml              # Deployment configuration
│   ├── service.yaml                 # Service configuration
│   ├── ingress.yaml                 # Ingress configuration
│   └── kustomization.yaml           # Kustomize configuration
│
├── src/
│   └── app/                         # Next.js App Router
│       ├── globals.css              # Global styles with Tailwind
│       ├── layout.tsx               # Root layout with SEO
│       └── page.tsx                 # Main application page
│
├── .dockerignore                    # Docker ignore file
├── .eslintrc.json                   # ESLint configuration
├── .gitignore                       # Git ignore file
├── Dockerfile                       # Multi-stage production build
├── next.config.js                   # Next.js config (standalone mode)
├── package.json                     # Dependencies and scripts
├── postcss.config.js                # PostCSS configuration
├── QUICKSTART_JP.md                 # Japanese quick start guide
├── README.md                        # English documentation
├── tailwind.config.ts               # Tailwind CSS configuration
└── tsconfig.json                    # TypeScript configuration
```

## File Descriptions

### Application Files

- **src/app/page.tsx**: Main application with YAML washing logic
- **src/app/layout.tsx**: Root layout with metadata and fonts
- **src/app/globals.css**: Global styles with dark theme and animations

### Configuration Files

- **next.config.js**: Configured with `output: 'standalone'` for Docker
- **tailwind.config.ts**: Custom color palette and animations
- **tsconfig.json**: TypeScript strict mode enabled
- **package.json**: All dependencies including js-yaml

### Docker & CI/CD

- **Dockerfile**: Multi-stage build for optimized production image
- **.dockerignore**: Excludes unnecessary files from Docker context
- **.github/workflows/build-push.yaml**: Automated build and push to GHCR

### Kubernetes

- **k8s/deployment.yaml**: Deployment with health checks and resource limits
- **k8s/service.yaml**: ClusterIP service exposing port 80
- **k8s/ingress.yaml**: Ingress template with TLS support
- **k8s/kustomization.yaml**: Kustomize configuration for easy deployment
- **k8s/create-ghcr-secret.sh**: Interactive script for creating image pull secret

### Documentation

- **README.md**: Comprehensive English documentation
- **QUICKSTART_JP.md**: Japanese quick start guide for beginners
