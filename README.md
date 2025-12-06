# K8s Manifest Washer 🧼

Transform dirty `kubectl get -o yaml` output into clean, deployable Kubernetes manifests.

## Features

- ✨ **Clean YAML**: Removes unnecessary metadata, status, and managed fields
- 🎨 **Modern UI**: Beautiful dark theme with glassmorphism effects
- ⚡ **Fast**: Client-side processing with instant results
- 📋 **Copy to Clipboard**: One-click copy for cleaned manifests
- 🔄 **Multi-document Support**: Handles YAML files with multiple documents

## What Gets Removed?

### Metadata Fields
- `uid`
- `resourceVersion`
- `generation`
- `creationTimestamp`
- `managedFields`
- `kubectl.kubernetes.io/last-applied-configuration` annotation

### Other Fields
- Entire `status` block

## Tech Stack

- **Framework**: Next.js 14 (App Router)
- **Language**: TypeScript
- **Styling**: Tailwind CSS
- **YAML Processing**: js-yaml
- **Deployment**: Docker + Kubernetes

## Getting Started

### Prerequisites

- Node.js 18+ and npm
- Docker (for containerization)
- Kubernetes cluster (for deployment)
- GitHub account (for CI/CD)

### Local Development

1. **Install dependencies**:
   ```bash
   npm install
   ```

2. **Run development server**:
   ```bash
   npm run dev
   ```

3. **Open browser**:
   Navigate to [http://localhost:3000](http://localhost:3000)

### Build for Production

```bash
npm run build
npm start
```

## Docker Deployment

### Build Docker Image Locally

```bash
docker build -t k8s-manifest-washer:latest .
```

### Run Docker Container

```bash
docker run -p 3000:3000 k8s-manifest-washer:latest
```

## Kubernetes Deployment

### 1. Create GHCR Pull Secret

If your GHCR repository is private, create an image pull secret:

```bash
kubectl create secret docker-registry ghcr-secret \
  --docker-server=ghcr.io \
  --docker-username=<YOUR_GITHUB_USERNAME> \
  --docker-password=<YOUR_GITHUB_PAT> \
  --docker-email=<YOUR_EMAIL>
```

**Note**: Generate a Personal Access Token (PAT) with `read:packages` scope from GitHub Settings → Developer settings → Personal access tokens.

### 2. Update Deployment Image

Edit `k8s/deployment.yaml` and replace `<YOUR_GITHUB_USER>` with your GitHub username:

```yaml
image: ghcr.io/<YOUR_GITHUB_USER>/k8s-manifest-washer:latest
```

### 3. Deploy to Kubernetes

```bash
kubectl apply -f k8s/deployment.yaml
kubectl apply -f k8s/service.yaml
kubectl apply -f k8s/ingress.yaml
```

### 4. Verify Deployment

```bash
kubectl get pods -l app=k8s-manifest-washer
kubectl get svc k8s-manifest-washer
kubectl get ingress k8s-manifest-washer
```

### 5. Configure Ingress

Update `k8s/ingress.yaml` with your domain:

```yaml
spec:
  rules:
    - host: washer.yourdomain.com  # Change this
```

## CI/CD with GitHub Actions

The project includes a GitHub Actions workflow that automatically builds and pushes Docker images to GHCR.

### Setup

1. **Push to GitHub**:
   ```bash
   git init
   git add .
   git commit -m "Initial commit"
   git remote add origin https://github.com/<YOUR_USERNAME>/k8s-manifest-washer.git
   git push -u origin main
   ```

2. **Enable GitHub Packages**:
   - Go to your repository settings
   - Navigate to Actions → General
   - Ensure "Read and write permissions" is enabled for workflows

3. **Trigger Build**:
   - Push to `main` branch triggers automatic build
   - Image is pushed to `ghcr.io/<YOUR_USERNAME>/k8s-manifest-washer:latest`

### Workflow Details

- **Trigger**: Push to `main` branch
- **Registry**: GitHub Container Registry (GHCR)
- **Tags**: `latest` and `main-<sha>`
- **Caching**: Enabled for faster builds

## Project Structure

```
k8s-manifest-washer/
├── .github/
│   └── workflows/
│       └── build-push.yaml      # GitHub Actions CI/CD
├── k8s/
│   ├── deployment.yaml          # Kubernetes Deployment
│   ├── service.yaml             # Kubernetes Service
│   └── ingress.yaml             # Kubernetes Ingress
├── src/
│   └── app/
│       ├── globals.css          # Global styles
│       ├── layout.tsx           # Root layout
│       └── page.tsx             # Main application
├── Dockerfile                   # Multi-stage Docker build
├── next.config.js               # Next.js configuration
├── package.json                 # Dependencies
├── tailwind.config.ts           # Tailwind CSS config
└── tsconfig.json                # TypeScript config
```

## Usage Example

1. Get a Kubernetes resource:
   ```bash
   kubectl get deployment my-app -o yaml > dirty.yaml
   ```

2. Copy the content of `dirty.yaml`

3. Paste into the left textarea in the app

4. Click "Wash & Minify"

5. Copy the cleaned YAML from the right textarea

6. Use it for deployment:
   ```bash
   kubectl apply -f clean.yaml
   ```

## Troubleshooting

### Image Pull Errors

If you see `ImagePullBackOff` errors:

1. Verify the image exists:
   ```bash
   docker pull ghcr.io/<YOUR_USERNAME>/k8s-manifest-washer:latest
   ```

2. Check if the secret is created:
   ```bash
   kubectl get secret ghcr-secret
   ```

3. Verify secret is referenced in deployment:
   ```yaml
   imagePullSecrets:
     - name: ghcr-secret
   ```

### Pod Not Starting

Check pod logs:
```bash
kubectl logs -l app=k8s-manifest-washer
kubectl describe pod -l app=k8s-manifest-washer
```

### Ingress Not Working

1. Verify Ingress controller is installed:
   ```bash
   kubectl get pods -n ingress-nginx
   ```

2. Check Ingress status:
   ```bash
   kubectl describe ingress k8s-manifest-washer
   ```

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## License

MIT License - feel free to use this project for any purpose.

## Author

Built with ❤️ for the Kubernetes community
