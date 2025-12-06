# Quick Start Guide

このガイドでは、K8s Manifest Washerを最速でセットアップする手順を説明します。

## 📋 前提条件

- Node.js 18以上がインストールされていること
- GitHubアカウントを持っていること
- Kubernetesクラスターへのアクセス権があること

## 🚀 ローカル開発

### 1. 依存関係のインストール

```bash
npm install
```

必要なパッケージ:
- `next`: Next.jsフレームワーク
- `react`, `react-dom`: Reactライブラリ
- `js-yaml`: YAMLパース・生成ライブラリ
- `@types/js-yaml`: js-yamlの型定義
- `tailwindcss`: CSSフレームワーク
- `typescript`: TypeScript

### 2. 開発サーバーの起動

```bash
npm run dev
```

ブラウザで http://localhost:3000 を開きます。

### 3. 動作確認

1. 左側のテキストエリアに以下のようなYAMLを貼り付けます:

```yaml
apiVersion: v1
kind: Pod
metadata:
  name: test-pod
  namespace: default
  uid: 12345678-1234-1234-1234-123456789abc
  resourceVersion: "123456"
  creationTimestamp: "2024-01-01T00:00:00Z"
  managedFields:
    - manager: kubectl
status:
  phase: Running
spec:
  containers:
    - name: nginx
      image: nginx:latest
```

2. "Wash & Minify"ボタンをクリック

3. 右側に綺麗なYAMLが表示されます

## 🐳 Dockerビルド

### ローカルでビルド

```bash
docker build -t k8s-manifest-washer:latest .
```

### ローカルで実行

```bash
docker run -p 3000:3000 k8s-manifest-washer:latest
```

## 🔄 GitHub ActionsでのCI/CD

### 1. GitHubリポジトリの作成

```bash
# プロジェクトディレクトリで実行
git init
git add .
git commit -m "Initial commit: K8s Manifest Washer"
```

GitHubで新しいリポジトリを作成し、以下を実行:

```bash
git remote add origin https://github.com/<YOUR_USERNAME>/k8s-manifest-washer.git
git branch -M main
git push -u origin main
```

### 2. GitHub Packagesの権限設定

1. リポジトリの Settings → Actions → General へ移動
2. "Workflow permissions" で "Read and write permissions" を選択
3. 保存

### 3. 自動ビルドの確認

`main`ブランチにpushすると、自動的にDockerイメージがビルドされ、GHCRにpushされます。

Actions タブで進行状況を確認できます。

## ☸️ Kubernetesへのデプロイ

### 1. GHCRシークレットの作成

#### 方法A: スクリプトを使用（推奨）

```bash
cd k8s
./create-ghcr-secret.sh
```

プロンプトに従って入力:
- GitHubユーザー名
- Personal Access Token (read:packages権限が必要)
- メールアドレス
- Namespace (デフォルト: default)

#### 方法B: 手動で作成

```bash
kubectl create secret docker-registry ghcr-secret \
  --docker-server=ghcr.io \
  --docker-username=<YOUR_GITHUB_USERNAME> \
  --docker-password=<YOUR_GITHUB_PAT> \
  --docker-email=<YOUR_EMAIL>
```

**Personal Access Tokenの作成方法:**
1. GitHub → Settings → Developer settings → Personal access tokens → Tokens (classic)
2. "Generate new token (classic)" をクリック
3. `read:packages` にチェック
4. トークンを生成してコピー

### 2. デプロイメントの更新

`k8s/deployment.yaml` を編集し、`<YOUR_GITHUB_USER>` を実際のGitHubユーザー名に置き換えます:

```yaml
image: ghcr.io/<YOUR_GITHUB_USER>/k8s-manifest-washer:latest
```

### 3. Kubernetesへのデプロイ

```bash
kubectl apply -f k8s/deployment.yaml
kubectl apply -f k8s/service.yaml
kubectl apply -f k8s/ingress.yaml
```

または、Kustomizeを使用:

```bash
kubectl apply -k k8s/
```

### 4. デプロイの確認

```bash
# Podの状態確認
kubectl get pods -l app=k8s-manifest-washer

# Serviceの確認
kubectl get svc k8s-manifest-washer

# Ingressの確認
kubectl get ingress k8s-manifest-washer
```

### 5. Ingressの設定

`k8s/ingress.yaml` を編集し、ドメインを設定:

```yaml
spec:
  rules:
    - host: washer.yourdomain.com  # あなたのドメインに変更
```

変更を適用:

```bash
kubectl apply -f k8s/ingress.yaml
```

## 🔧 トラブルシューティング

### ImagePullBackOff エラー

```bash
# Podの詳細を確認
kubectl describe pod -l app=k8s-manifest-washer

# シークレットが存在するか確認
kubectl get secret ghcr-secret

# イメージが存在するか確認（ローカルから）
docker pull ghcr.io/<YOUR_USERNAME>/k8s-manifest-washer:latest
```

### Podが起動しない

```bash
# ログを確認
kubectl logs -l app=k8s-manifest-washer

# イベントを確認
kubectl get events --sort-by='.lastTimestamp'
```

### Ingressが機能しない

```bash
# Ingress Controllerが動作しているか確認
kubectl get pods -n ingress-nginx

# Ingressの詳細を確認
kubectl describe ingress k8s-manifest-washer
```

## 📚 次のステップ

- [ ] カスタムドメインの設定
- [ ] TLS/HTTPSの有効化（cert-manager使用）
- [ ] リソース制限の調整
- [ ] HPA（Horizontal Pod Autoscaler）の設定
- [ ] モニタリング・ロギングの追加

## 💡 ヒント

### 本番環境での推奨設定

1. **レプリカ数の増加**: 高可用性のため、`replicas: 3` に設定
2. **リソース制限の調整**: トラフィックに応じて調整
3. **TLSの有効化**: cert-managerでLet's Encrypt証明書を自動取得
4. **モニタリング**: Prometheus + Grafanaでメトリクス監視

### 開発ワークフロー

1. ローカルで開発・テスト (`npm run dev`)
2. 変更をコミット・プッシュ
3. GitHub Actionsが自動ビルド
4. Kubernetesで新しいイメージをデプロイ

```bash
# イメージの更新をKubernetesに反映
kubectl rollout restart deployment/k8s-manifest-washer
```

## 🎉 完了！

これで K8s Manifest Washer が稼働しています。
ブラウザでアクセスして、YAMLのクリーニングを試してみてください！
