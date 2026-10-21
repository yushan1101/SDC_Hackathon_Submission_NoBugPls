#!/usr/bin/env bash
# One-time setup of the GitHub Actions self-hosted runner that auto-deploys this repo (.github/workflows/deploy.yml).
# Run ON THE SERVER as root, with a registration token from: repo Settings -> Actions -> Runners -> New self-hosted runner
# (only a repo admin can create one; it expires after 1 hour):
#
#   RUNNER_TOKEN=<token> bash setup-runner.sh
#
# Creates a "deploy" user (no password, no sudo) that can run docker and write only /opt/aiversepulse/app, installs the
# latest official runner from github.com/actions/runner, labels it "aiversepulse-server", and runs it as a service.
set -euo pipefail
: "${RUNNER_TOKEN:?set RUNNER_TOKEN to the registration token from GitHub}"
REPO_URL="${REPO_URL:-https://github.com/yushan1101/SDC_Hackathon_Submission_NoBugPls}"
APP_DIR=/opt/aiversepulse
RUNNER_DIR=/opt/actions-runner

id deploy >/dev/null 2>&1 || useradd --create-home --shell /bin/bash deploy
usermod -aG docker deploy
mkdir -p "$APP_DIR/app"
chown -R deploy:deploy "$APP_DIR/app"
chown root:deploy "$APP_DIR/.env" && chmod 640 "$APP_DIR/.env"   # compose (run as deploy) reads the keys; nobody else can
command -v rsync >/dev/null || apt-get install -y rsync

mkdir -p "$RUNNER_DIR" && chown deploy:deploy "$RUNNER_DIR"
if [ ! -f "$RUNNER_DIR/config.sh" ]; then
  VERSION=$(curl -fsSL https://api.github.com/repos/actions/runner/releases/latest | grep -oP '"tag_name":\s*"v\K[^"]+')
  su deploy -c "cd $RUNNER_DIR && curl -fsSL -o runner.tgz https://github.com/actions/runner/releases/download/v${VERSION}/actions-runner-linux-x64-${VERSION}.tar.gz && tar xzf runner.tgz && rm runner.tgz"
fi
su deploy -c "cd $RUNNER_DIR && ./config.sh --unattended --replace --url '$REPO_URL' --token '$RUNNER_TOKEN' --name aiversepulse-server --labels aiversepulse-server --work _work"
cd "$RUNNER_DIR" && ./svc.sh install deploy && ./svc.sh start
./svc.sh status | head -5
echo "Runner ready. Push to main (or run 'Deploy to server' in the Actions tab) to deploy."
