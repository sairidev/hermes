#!/bin/bash
#
# Hermes Agent (web) · SAIRI edition entrypoint
#
# 1. menampilkan banner HERMES + info sistem + status koneksi 9Router
# 2. menjalankan Hermes:
#      - ada argumen              -> jalankan argumen itu   (docker run image bash)
#      - Pterodactyl (STARTUP)    -> tanya "jalankan Hermes? (y/n)", lalu jalankan startup command
#      - terminal interaktif      -> hermes-web
#      - detached / tanpa terminal-> hermes-web

HERMES_WEB_HOME="${HERMES_WEB_HOME:-/opt/hermes-web}"

cd /home/container 2>/dev/null || cd "${HOME:-/}" || true
export HOME="${HOME:-/home/container}"
export INTERNAL_IP
INTERNAL_IP=$(ip route get 1 2>/dev/null | sed -n 's/.* src \([0-9.]*\).*/\1/p' | head -n1)

# --- ANSI colors ------------------------------------------------------------
RESET='\033[0m'
BOLD='\033[1m'
CYAN='\033[1;36m'
GREEN='\033[1;32m'
YELLOW='\033[1;33m'
RED='\033[1;31m'
BLUE='\033[1;34m'
MAGENTA='\033[1;35m'
PINK='\033[38;5;212m'
GRAY='\033[0;90m'

LINE="${GRAY}$(printf '%.0s─' $(seq 1 60))${RESET}"

# --- helpers ----------------------------------------------------------------
make_bar() {
    local percent=$1 width=25
    [ "$percent" -gt 100 ] && percent=100
    [ "$percent" -lt 0 ] && percent=0
    local filled=$(( percent * width / 100 ))
    local empty=$(( width - filled ))
    local bar=""
    [ "$filled" -gt 0 ] && bar+=$(printf '%0.s█' $(seq 1 "$filled"))
    [ "$empty" -gt 0 ] && bar+=$(printf '%0.s░' $(seq 1 "$empty"))
    echo -n "$bar"
}

# Memori seperti yang dilihat container (limit cgroup), fallback ke angka host.
read_memory() {
    local host_total used_b total_b
    host_total=$(free -m 2>/dev/null | awk '/Mem:/ {print $2}')
    MEM_TOTAL=${host_total:-0}
    MEM_USED=$(free -m 2>/dev/null | awk '/Mem:/ {print $3}')
    MEM_USED=${MEM_USED:-0}

    if [ -r /sys/fs/cgroup/memory.max ]; then                          # cgroup v2
        total_b=$(cat /sys/fs/cgroup/memory.max 2>/dev/null)
        used_b=$(cat /sys/fs/cgroup/memory.current 2>/dev/null)
    elif [ -r /sys/fs/cgroup/memory/memory.limit_in_bytes ]; then      # cgroup v1
        total_b=$(cat /sys/fs/cgroup/memory/memory.limit_in_bytes 2>/dev/null)
        used_b=$(cat /sys/fs/cgroup/memory/memory.usage_in_bytes 2>/dev/null)
    fi

    if [[ "$total_b" =~ ^[0-9]+$ ]] && [[ "$used_b" =~ ^[0-9]+$ ]]; then
        local total_mb=$(( total_b / 1024 / 1024 ))
        if [ "$total_mb" -gt 0 ] && { [ "$MEM_TOTAL" -eq 0 ] || [ "$total_mb" -lt "$MEM_TOTAL" ]; }; then
            MEM_TOTAL=$total_mb
            MEM_USED=$(( used_b / 1024 / 1024 ))
        fi
    fi
    [ "$MEM_TOTAL" -le 0 ] && MEM_TOTAL=1
    MEM_PERCENT=$(( MEM_USED * 100 / MEM_TOTAL ))
}

print_logo() {
    echo -e "${MAGENTA}${BOLD}"
    cat <<'ART'
 _  _ ___ ___ __  __ ___ ___
| || | __| _ \  \/  | __/ __|
| __ | _||   / |\/| | _|\__ \
|_||_|___|_|_\_|  |_|___|___/
ART
    echo -e "${RESET}${GRAY}  Hermes Agent ──▶ 🧠 9Router ──▶ Claude · GPT · Gemini · 60+${RESET}"
}

# Status 9Router: online / API key / tidak bisa dihubungi (maks. ± 4 detik).
router_status() {
    local url="${NINEROUTER_URL%/}"
    if [ -z "$url" ]; then
        echo -e "${YELLOW}belum diisi${RESET} ${GRAY}(variabel NINEROUTER_URL)${RESET}"
        return
    fi
    [[ "$url" =~ ^https?:// ]] || url="http://${url}"
    url="${url%/v1}"
    local code auth
    code=$(curl -s -o /dev/null -m 4 -w '%{http_code}' "${url}/v1/models" 2>/dev/null)
    if [ "$code" != "200" ]; then
        echo -e "${url} ${RED}✗ tidak bisa dihubungi${RESET} ${GRAY}(HTTP ${code:-000})${RESET}"
        return
    fi
    auth=()
    [ -n "${NINEROUTER_API_KEY}" ] && auth=(-H "Authorization: Bearer ${NINEROUTER_API_KEY}")
    code=$(curl -s -o /dev/null -m 4 -w '%{http_code}' -X POST -H 'Content-Type: application/json' \
        "${auth[@]}" -d '{}' "${url}/v1/chat/completions" 2>/dev/null)
    if [ "$code" = "401" ] || [ "$code" = "403" ]; then
        echo -e "${url} ${GREEN}✓ online${RESET} ${RED}· API key ditolak${RESET}"
    else
        echo -e "${url} ${GREEN}✓ online · API key OK${RESET}"
    fi
}

# y/n. Enter atau tidak dijawab sampai timeout = "y", jadi restart otomatis
# (setelah crash / reboot node) tidak pernah menggantung di pertanyaan ini.
ask_start() {
    local timeout="${START_PROMPT_TIMEOUT:-30}" ans
    while true; do
        echo -e "${PINK}${BOLD}Jalankan Hermes sekarang? (y/n)${RESET} ${GRAY}[Enter/otomatis = y dalam ${timeout} detik]${RESET}"
        if ! read -r -t "$timeout" ans; then
            return 0
        fi
        case "${ans,,}" in
            ""|y|yes|ya) return 0 ;;
            n|no|tidak)  return 1 ;;
            *) echo -e "${YELLOW}Ketik y (yes) atau n (no).${RESET}" ;;
        esac
    done
}

# "n": Hermes tidak dijalankan, buka shell
open_shell() {
    echo -e "${PINK}${BOLD}Silahkan masukan perintah.${RESET}"
    echo -e "${GRAY}Jalankan dashboard Hermes kapan saja : hermes-web${RESET}"
    echo -e "${GRAY}Chat lewat terminal                  : hermes chat${RESET}"
    echo -e "${GRAY}Cek model di 9Router                 : curl -s \${NINEROUTER_URL}/v1/models | jq -r '.data[].id'${RESET}"
    export PS1='\[\e[1;35m\]hermes\[\e[0m\]:\[\e[1;34m\]\w\[\e[0m\]\$ '
    exec /bin/bash --norc -i
}

show_banner() {
    read_memory
    local disk_used disk_total disk_percent
    disk_used=$(df -h /home/container 2>/dev/null | awk 'NR==2 {print $3}')
    disk_total=$(df -h /home/container 2>/dev/null | awk 'NR==2 {print $2}')
    disk_percent=$(df -h /home/container 2>/dev/null | awk 'NR==2 {print $5}' | tr -d '%')
    disk_percent=${disk_percent:-0}

    local os_name cpu_name cpu_cores location
    os_name=$(grep -oP '(?<=^PRETTY_NAME=).+' /etc/os-release 2>/dev/null | tr -d '"')
    cpu_name=$(grep -m1 'model name' /proc/cpuinfo 2>/dev/null | cut -d: -f2 | sed 's/^ //')
    cpu_cores=$(grep -c ^processor /proc/cpuinfo 2>/dev/null)
    location=$(curl -s --max-time 2 ipinfo.io/country 2>/dev/null | tr -d '\n')
    [[ "$location" =~ ^[A-Z]{2}$ ]] || location="Unknown"

    local hermes_v python_v node_v port pass_state key_state gateway_state
    hermes_v=$(sed -n 's/^__release_date__ *= *"\(.*\)"/\1/p' "${HERMES_WEB_HOME}/hermes/hermes_cli/__init__.py" 2>/dev/null | head -n1)
    python_v=$("${HERMES_WEB_HOME}/.runtime/venv/bin/python" -V 2>/dev/null | awk '{print $2}')
    node_v=$(node -v 2>/dev/null || echo "Not Installed")
    port="${SERVER_PORT:-${PORT:-3000}}"
    if [ -n "${ADMIN_PASSWORD}" ]; then
        pass_state="${GREEN}set${RESET}"
    else
        pass_state="${YELLOW}otomatis${RESET} ${GRAY}(lihat console / data/secrets.json)${RESET}"
    fi
    if [ -n "${NINEROUTER_API_KEY}" ]; then key_state="${GREEN}set${RESET}"; else key_state="${YELLOW}not set${RESET}"; fi
    if [[ "${HERMES_GATEWAY,,}" == "true" || "${HERMES_GATEWAY}" == "1" ]]; then gateway_state="${GREEN}aktif${RESET}"; else gateway_state="${GRAY}mati${RESET}"; fi

    [ -t 1 ] && clear
    print_logo
    echo -e "$LINE"
    echo -e "${CYAN}Location${RESET}   : ${location}"
    if [[ "${SHOW_IP,,}" == "true" || "${SHOW_IP}" == "1" ]]; then
        local public_ip
        public_ip=$(curl -s --max-time 2 ipinfo.io/ip 2>/dev/null | tr -d '\n')
        [[ "$public_ip" =~ ^[0-9a-fA-F:.]+$ ]] || public_ip="Unknown"
        echo -e "${CYAN}IP Address${RESET} : ${public_ip}"
    fi
    echo -e "${CYAN}OS${RESET}         : ${os_name:-Unknown}"
    echo -e "${CYAN}CPU${RESET}        : ${cpu_name:-Unknown} (${cpu_cores:-?} Cores)"
    echo -e "${CYAN}Uptime${RESET}     : $(uptime -p 2>/dev/null | sed 's/up //')"
    echo -e "${CYAN}RAM${RESET}  ${YELLOW}${MEM_PERCENT}%${RESET}  ${GREEN}$(make_bar "$MEM_PERCENT")${RESET}  ${GRAY}${MEM_USED}/${MEM_TOTAL}MB${RESET}"
    echo -e "${CYAN}Disk${RESET} ${YELLOW}${disk_percent}%${RESET}  ${YELLOW}$(make_bar "$disk_percent")${RESET}  ${GRAY}${disk_used:-?}/${disk_total:-?}${RESET}"
    echo -e "$LINE"
    echo -e "${BLUE}Hermes${RESET}       : ${hermes_v:-?}"
    echo -e "${BLUE}Python${RESET}       : ${python_v:-Not Installed}"
    echo -e "${BLUE}Node.js${RESET}      : ${node_v}"
    echo -e "${BLUE}Port${RESET}         : ${port}"
    echo -e "${BLUE}Data dir${RESET}     : ${DATA_DIR:-/home/container/data}"
    echo -e "${BLUE}Password${RESET}     : ${pass_state}"
    echo -e "$LINE"
    echo -e "${MAGENTA}9Router${RESET}      : $(router_status)"
    echo -e "${MAGENTA}API key${RESET}      : ${key_state}"
    echo -e "${MAGENTA}Model${RESET}        : ${HERMES_MODEL:-kr/claude-sonnet-4.5}"
    echo -e "${MAGENTA}Gateway bot${RESET}  : ${gateway_state}"
    echo -e "$LINE"
}

# --- go ---------------------------------------------------------------------
show_banner

# 1) perintah eksplisit (docker run image bash)
if [ "$#" -gt 0 ]; then
    exec "$@"
fi

# 2) Pterodactyl / Pelican: panel mengirim startup command lewat $STARTUP
if [ -n "${STARTUP}" ]; then
    # {{VAR}} -> ${VAR} lalu di-expand (cara yang sama dengan yolks resmi)
    PARSED=$(echo "${STARTUP}" | sed -e 's/{{/${/g' -e 's/}}/}/g' | eval echo "$(cat -)")
    if ask_start; then
        echo -e "${GREEN}${BOLD}Memulai Hermes...${RESET}"
        # shellcheck disable=SC2086
        exec env ${PARSED}
    fi
    open_shell
fi

# 3) docker biasa dengan terminal (docker run -it) / 4) detached (docker run -d)
echo -e "${PINK}${BOLD}Menjalankan Hermes...${RESET}"
exec /usr/local/bin/hermes-web
