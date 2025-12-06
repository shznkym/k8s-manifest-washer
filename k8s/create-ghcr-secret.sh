#!/bin/bash

# K8s Manifest Washer - GHCR Secret Creation Helper
# This script helps you create a Kubernetes secret for pulling images from GitHub Container Registry

echo "🔐 GHCR Secret Creation Helper"
echo "================================"
echo ""

# Check if kubectl is available
if ! command -v kubectl &> /dev/null; then
    echo "❌ Error: kubectl is not installed or not in PATH"
    exit 1
fi

# Prompt for GitHub username
read -p "Enter your GitHub username: " GITHUB_USERNAME

# Prompt for GitHub Personal Access Token
echo ""
echo "ℹ️  You need a GitHub Personal Access Token with 'read:packages' scope"
echo "   Create one at: https://github.com/settings/tokens/new"
echo ""
read -sp "Enter your GitHub Personal Access Token: " GITHUB_PAT
echo ""

# Prompt for email
read -p "Enter your email: " EMAIL

# Prompt for namespace (optional)
read -p "Enter Kubernetes namespace (default: default): " NAMESPACE
NAMESPACE=${NAMESPACE:-default}

echo ""
echo "Creating secret in namespace: $NAMESPACE"

# Create the secret
kubectl create secret docker-registry ghcr-secret \
  --docker-server=ghcr.io \
  --docker-username="$GITHUB_USERNAME" \
  --docker-password="$GITHUB_PAT" \
  --docker-email="$EMAIL" \
  --namespace="$NAMESPACE"

if [ $? -eq 0 ]; then
    echo ""
    echo "✅ Secret 'ghcr-secret' created successfully!"
    echo ""
    echo "Next steps:"
    echo "1. Update k8s/deployment.yaml with your GitHub username"
    echo "2. Deploy the application: kubectl apply -f k8s/"
else
    echo ""
    echo "❌ Failed to create secret. Please check your inputs and try again."
    exit 1
fi
