#!/usr/bin/env bash
# ============================================================================
# WBPSC — Oracle VM readiness check. Run ON THE VM:
#   bash vm-check.sh
# Prints the machine's shape and flags anything too small for the full stack
# (Postgres + Redis + api-core + api-ai + web + Caddy, built on the VM).
# ============================================================================

ok()   { printf '  \033[32m✓\033[0m %s\n' "$1"; }
warn() { printf '  \033[33m!\033[0m %s\n' "$1"; }
bad()  { printf '  \033[31m✗\033[0m %s\n' "$1"; }

echo "== Machine =="
arch=$(uname -m)
cpus=$(nproc)
mem_gb=$(awk '/MemTotal/ {printf "%.1f", $2/1024/1024}' /proc/meminfo)
disk_gb=$(df -BG --output=size / | tail -1 | tr -dc '0-9')
free_gb=$(df -BG --output=avail / | tail -1 | tr -dc '0-9')
. /etc/os-release 2>/dev/null

echo "  OS:    ${PRETTY_NAME:-unknown}"
echo "  Arch:  $arch   CPUs: $cpus   RAM: ${mem_gb} GB   Disk: ${disk_gb} GB (${free_gb} GB free)"

[ "$arch" = "aarch64" ] && ok "Ampere A1 (ARM) — the generous Always Free shape" \
  || warn "x86 ($arch) — fine if RAM is enough; Always Free x86 (E2.1.Micro) has only 1 GB"

awk "BEGIN{exit !($mem_gb >= 6)}"  && ok "RAM ${mem_gb} GB is enough" \
  || { awk "BEGIN{exit !($mem_gb >= 2)}" && warn "RAM ${mem_gb} GB is tight — add 4 GB swap (see guide)" \
  || bad "RAM ${mem_gb} GB is too small — recreate as VM.Standard.A1.Flex (2–4 OCPU, 12–24 GB)"; }

[ "$cpus" -ge 2 ] && ok "$cpus CPUs" || warn "Only $cpus CPU — builds will be slow"
[ "${free_gb:-0}" -ge 20 ] && ok "${free_gb} GB free disk" || bad "Less than 20 GB free disk — enlarge the boot volume"

case "$ID" in
  ubuntu) ok "Ubuntu — guide commands apply as written (user: ubuntu)";;
  ol|oracle) warn "Oracle Linux — use dnf/firewalld variants in the guide (user: opc)";;
  *) warn "Untested OS: ${ID:-unknown}";;
esac

echo
echo "== Network =="
pub_ip=$(curl -s --max-time 5 https://ifconfig.me || true)
[ -n "$pub_ip" ] && ok "Internet access works; public IP: $pub_ip" \
  || bad "No outbound internet — check the subnet's Internet Gateway / route table"

if command -v iptables >/dev/null 2>&1; then
  for port in 80 443; do
    if sudo iptables -C INPUT -p tcp --dport "$port" -m state --state NEW -j ACCEPT 2>/dev/null; then
      ok "OS firewall allows port $port"
    else
      warn "OS firewall does not allow port $port yet (fixed in step 4 of the guide)"
    fi
  done
fi

echo
echo "== Software =="
command -v docker >/dev/null 2>&1 && ok "Docker $(docker --version | awk '{print $3}' | tr -d ,)" \
  || warn "Docker not installed yet (step 3 of the guide)"
docker compose version >/dev/null 2>&1 && ok "Docker Compose plugin present" \
  || warn "Docker Compose plugin not installed yet"
command -v git >/dev/null 2>&1 && ok "git present" || warn "git not installed (sudo apt install -y git)"
swap_gb=$(awk '/SwapTotal/ {printf "%.1f", $2/1024/1024}' /proc/meminfo)
echo "  Swap: ${swap_gb} GB"
