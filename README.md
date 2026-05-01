# Dream League Live Screen Sharing Platform

## Local Run

```powershell
npm install
npm start
```

Open:

```text
http://localhost:3000
http://localhost:3000/admin
```

## Render Deployment

Use these Render settings:

```text
Environment: Node
Root Directory: leave empty
Build Command: npm install
Start Command: npm start
Health Check Path: /healthz
```

The `public` folder must be pushed to GitHub with `server.js` and `package.json`.
Do not deploy only the `public` folder, and do not set Render Root Directory to `public`.
