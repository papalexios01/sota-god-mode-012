# Cloudflare Pages preflight

```powershell
npm ci --legacy-peer-deps
npm run build
```

```powershell
Select-String -Path .\src\**\*.ts,.\src\**\*.tsx -Pattern "<<<<<<<|=======|>>>>>>>" -List
```
Should return nothing.
