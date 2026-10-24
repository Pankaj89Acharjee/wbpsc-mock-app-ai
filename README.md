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

