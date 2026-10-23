# Running in Local PC
---

- **Clone and install dependencies**

```bash
git clone https://github.com/papon2002/wbpsc-mock-app-ai.git
cd wbpsc-mock-app-ai
npm install
```

- **Run the application**

```bash
npm run dev
```


- **Run with cloud Firebase**
Zero Docker overhead. Because `firebase-applet-config.json` is included in the repository, running the dev server connects directly to your live Firebase Auth + Firestore instance:

```bash
npm run dev
```

Next open `http://localhost:3000` on your PC.



- **Test on Android Vivo X200 FE over Wi-Fi (No Android Emulator Needed):**

1. Find your PC's local IP address (`ipconfig` on Windows or `hostname -I` on Linux, e.g., `192.168.1.100`).
2. On your Vivo X200 FE browser connected to the same Wi-Fi, open `http://<YOUR_PC_LAN_IP>:3000`.
3. (Optional) To use Google Sign-In on your LAN IP, add your LAN IP (`192.168.x.x`) under Firebase Console > Authentication > Settings > Authorized domains. Email/Password login works on any LAN IP out of the box.


- **Run Local Docker Infrastructure (pgvector + redis capped at 512MB RAM):**
If you want to test the standalone microservices (`apps/api-core` and `apps/api-ai`) locally:

```bash
docker compose up -d
docker stats --no-stream
```

- **Run Fastify Core API (Port 8080) & FastAPI AI Service (Port 8081)**
  ```bash
  npm run dev:api-core
  npm run dev:api-ai
  ```

- **Test Mobile on Vivo X200 FE over Wi-Fi (No Android Emulator!)**
  ```bash
  npx expo start --lan
  ```