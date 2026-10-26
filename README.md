# Running in Local PC
---

Everything runs on your own machine (and later the Oracle VM): PostgreSQL + Redis in Docker,
`apps/api-core` (accounts, exams, grading), `apps/api-ai` (Gemini) and the web app. No Firebase.

- **Clone, configure and install**

```bash
git clone https://github.com/papon2002/wbpsc-mock-app-ai.git
cd wbpsc-mock-app-ai
cp .env.example .env        # then fill in the values marked "replace-with-…"
npm install
```

Key `.env` values:

| Variable | What it is |
|---|---|
| `JWT_ACCESS_SECRET` | Long random string that signs login sessions |
| `ADMIN_EMAIL` / `ADMIN_PASSWORD` | The only admin account (password optional if you use Google) |
| `GOOGLE_CLIENT_ID` | OAuth client ID for "Continue with Google" (optional) |
| `INTERNAL_SERVICE_TOKEN` | Shared secret between api-core and api-ai |
| `GEMINI_API_KEY` | Google AI Studio key used by api-ai |

- **Start the database and load sample data**

```bash
docker compose up -d
npm run db:push
npm run seed:syllabus && npm run seed
```

- **Start the services (one terminal each)**

```bash
npm run dev:api-core     # API on http://localhost:8080
npm run dev:api-ai       # AI service on :8081 — first time: cd apps/api-ai && python -m venv .venv && .venv\Scripts\pip install -r requirements.txt, then activate .venv
npm run dev              # web app on http://localhost:3000
```

Open `http://localhost:3000` and sign in with the admin email.

- **Test on Android Vivo X200 FE over Wi-Fi (No Android Emulator Needed):**

1. Find your PC's local IP address (`ipconfig` on Windows, e.g. `192.168.1.100`).
2. Add `http://<YOUR_PC_LAN_IP>:3000` to `CORS_ALLOWED_ORIGINS` and set `VITE_API_CORE_URL=http://<YOUR_PC_LAN_IP>:8080` in `.env`.
3. On the phone's browser (same Wi-Fi) open `http://<YOUR_PC_LAN_IP>:3000`.
4. Google sign-in on a LAN IP also needs that origin added to the OAuth client's "Authorized JavaScript origins" in Google Cloud Console. Email/password works without it.

- **Test Mobile on Vivo X200 FE over Wi-Fi (No Android Emulator!)**
  ```bash
  npx expo start --lan
  ```
---



## **SSH into Oracle VM**
---

**Oracle VM Public IP** - 129.225.127.229

1. Open Gitbash
2. Locate to .ssh folder and check whether ssh keys are present or not.
```bash
ls -l ~/.ssh
```
3. If they are present then ssh into VM

```bash
ssh -i ~/.ssh/oracle-vm-ssh/ssh-key-oraclevm-wbpsc-latest.key ubuntu@129.225.127.229
```

I have created a folder inside `./ssh`. So path became `./ssh/oracle-vm-ssh`, and here I have kept the keys. Here private key is used (with .key extension).
---



## **Adding IINGRESS rule in Oracle VM**
---

Part 1: Open Ports in the Oracle Cloud Console

Log into the Oracle Cloud Dashboard in your web browser.

Click the hamburger menu (top left) and navigate to Networking > Virtual Cloud Networks.

Click on your VCN (it will likely be named vcn-<date>).

Under "Subnets", click your subnet (e.g., subnet-<date>).

Under "Security Lists", click the Default Security List.

Click the Add Ingress Rules button.

Fill out the rule exactly like this:

Source Type: CIDR

Source CIDR: 0.0.0.0/0

IP Protocol: TCP

Destination Port Range: 80, 443 (You can open both at once using a comma).

Click Add Ingress Rules to save.

Part 2: Open Ports Inside the VM (Ubuntu Firewall)
Open Git Bash and SSH into your VM using your key:

```bash
ssh -i ~/.ssh/ssh-key-2026-10-24-latest.key ubuntu@129.225.127.229
```

Once connected, copy and paste these exact commands one by one into the terminal and press Enter after each:

```bash
sudo iptables -I INPUT -p tcp --dport 80 -j ACCEPT
sudo iptables -I INPUT -p tcp --dport 443 -j ACCEPT
sudo netfilter-persistent save
```

Part 3: Test the Connection

Start the server on the VM: While still logged into the VM in Git Bash, run this command to start a temporary web server:
```bash
sudo python3 -m http.server 80
```

(Your terminal will appear "stuck" or waiting—this means the server is running.)

Test from your PC: Do not close the current window. Open a new, second Git Bash window on your computer. In this new window, run:

```bash
curl -I http://129.225.127.229
```

If it worked, you will see a response starting with `HTTP/1.0 200 OK`.
Your ports are now permanently open and ready for your Docker containers!
---



## **Install Docker on the VM**
---
1. Install Docker and Update Permissions
Copy and paste this line into your terminal:
```bash
curl -fsSL https://get.docker.com | sudo sh && sudo usermod -aG docker $USER && exit
```

Note: The exit at the end of that command will intentionally kick you out of the server and close the SSH connection. This is required for the new Docker permissions to take effect.

2. Log Back In and Test Docker
Press the Up Arrow key on your keyboard to bring back your SSH command, or type it again:

```bash
ssh -i ~/.ssh/ssh-key-2026-10-24-latest.key ubuntu@129.225.127.229
```

Once you are logged back in, test if Docker works without sudo:
```bash
docker run --rm hello-world
```

3. Add the Swap File (If Memory is very low)
Even with 12GB of RAM, adding a swap file is a great safety net for heavy AI and Node.js operations. Copy and paste this exact block:
```bash
sudo fallocate -l 4G /swapfile
sudo chmod 600 /swapfile
sudo mkswap /swapfile
sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
```

(You can verify it worked by typing free -h. You should see 4.0G listed in the Swap row).
---



## **Get the code into VM**
---

```bash
git clone https://github.com/Pankaj89Acharjee/wbpsc-mock-app-ai.git && cd wbpsc-mock-app-ai
```

Create .env file and insert the values
```bash
cp .env.example .env && nano .env
```

---

## **Important Commands**
---

1. To check the running containers with name of **service**
```bash
C="docker compose -f docker-compose.prod.yml"
$C ps
```

2. Read the Logs / Crash Logs
```bash
C="docker compose -f docker-compose.prod.yml"
$C logs --tail 50 web
```

3. Rebuild and Restart - If you updated some code and pushed code in Github, you then need that code in Oracle VM to deploy the changes.

```bash
cd ~/wbpsc-mock-app-ai
git pull
C="docker compose -f docker-compose.prod.yml"
$C up -d --build api-core        # if api-core service needs to rebuild
$C logs --tail 20 api-core       # should end with "wbpsc-api-core listening on http://0.0.0.0:8080"
```

Next test from Git Bash
```bash
curl http://129.225.127.229/api/health

```

4. Check the Backend Logs - To see if the Express server actually received the request, you can check the live Docker logs on your Oracle VM. Go to the terminal connected to your VM and run:

```bash
docker compose -f docker-compose.prod.yml logs -f web
```

5. Check the Status Code
Run the curl command with the -i flag (lowercase i shows both headers AND the body). This will tell you if the API is returning a 200 OK, a 404 Not Found, or a 502 Bad Gateway:

```bash
curl -i http://129.225.127.229/api/health
```
---

6. If something is changed in .env and need to re-create the containers. simple `restart` will not work.
```bash
docker compose -f docker-compose.prod.yml up -d --force-recreate api-ai api-core web
```


## **Free Domain Service and HTTPS**
---
1. Go to duckdns.org, sign in, and create a subdomain such as wbpsc-prep, pointing to your VM's public IP

2. In the VM's `.env`, set `SITE_ADDRESS="wbpsc-mockapp.duckdns.org"` and `COOKIE_SECURE="true"`. Then run `$C up -d`. Caddy fetches the *HTTPS certificate* automatically.

3. In Google Cloud Console, add `wbpsc-mockapp.duckdns.org` to the OAuth client's Authorized JavaScript origins.
---


## **CICD Pipeline in Github Actions**
---

1. **Timeout:** `appleboy/ssh-action` stops after **10 minutes** by default. A rebuild of all images on the VM can take longer, so the job would fail midway. Add `command_timeout: 30m`.

2. **No stop on error:** if `git pull` fails (say, a conflict on the VM), the script still rebuilds the old code and the job shows ✅. Add `set -e` and use `git pull --ff-only`.

3. **Overlapping deploys:** two quick pushes can run two builds at once on the VM. Add a `concurrency` group.

4. **No health check:** the job passes even if api-core crashes after starting. Add a check at the end.

5. **Docs-only pushes:** a README-only push triggers a full rebuild. `paths-ignore` skips those (optional).


*Path = [.github/workflows/deploy.yml] ==> file structure*

```bash
name: Deploy to Oracle VM

on:
  push:
    branches:
      - main
    paths-ignore:
      - "**.md"

concurrency:
  group: deploy-oracle-vm
  cancel-in-progress: false

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - name: SSH into Oracle VM and Deploy
        uses: appleboy/ssh-action@v1.0.3
        with:
          host: ${{ secrets.HOST }}
          username: ${{ secrets.USERNAME }}
          key: ${{ secrets.SSH_PRIVATE_KEY }}
          command_timeout: 30m
          script: |
            set -e
            cd ~/wbpsc-mock-app-ai
            git pull --ff-only origin main
            docker compose -f docker-compose.prod.yml up -d --build
            docker image prune -f

            # Fail the job if api-core, api-ai and web come up healthy
            C="docker compose -f docker-compose.prod.yml"
            for i in $(seq 1 30); do
              core=0; ai=0; web=0
              $C exec -T api-core wget -q0- http://localhost:8080/health >/dev/null 2>&1 && core=1
              $C exec -T api-ai python -c "import urllib.request as u; u.urlopen('http://localhost:8080/health')" >/dev/null 2>&1 && ai=1
              $C exec -T web node -e "fetch('http://localhost:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))" >/dev/null 2>&1 && web=1
              if [ "$core$ai$web" = "111" ]; then echo "deploy OK: all services healthy"; exit 0; fi          
              sleep 5
            done
            echo "Unhealthy after 150s: api-core=$core api-ai=$ai web=$web"
            $C logs --tail 30 api-core api-ai web            
            exit 1
```

**What to do in Github website with repo**

**Repository secrets** (Settings --> Secrets and Variables --> Actions):

- `HOST` = `129.225.127.229`
- `USERNAME` = `ubuntu`
- `SSH_PRIVATE_KEY` = the full contents of my `.key` file, including the `-----BEGIN ...-----` and `-----END ...-----` lines. Get it with `cat ~/.ssh/oracle-vm-ssh/ssh-key-oraclevm-wbpsc-latest.key`.

**Database changes are not automatic**. If a push changes the database schema (`schema.ts`), run *`docker compose -f docker-compose.prod.yml run --rm --no-deps web npm run db:push`* on the VM yourself. Don't automate it: `db:push` can ask questions or drop data, so it's safer to run by hand.

---




## *Current Affairs Automation**
---

Website - https://www.pyqarena.com/current-affairs-from-the-hindu-2nd-september-2026/

Need a cron job every night to fetch and extract the CA from this site into our pgvector. 

Later form questions and practice set from pgvector.

---

