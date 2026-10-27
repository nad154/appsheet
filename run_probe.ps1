node 'C:\user\storage file\opencode2\_boot-probe.cjs'
Start-Sleep -Seconds 35
node -e "const fs=require('fs');const d=fs.readFileSync('C:/Users/Asus/AppData/Local/Temp/opencode/boot-err.log','utf8');const i=d.indexOf('failed to delete');if(i>=0){console.log(d.slice(Math.max(0,i-80),i+350));}else{console.log(d.slice(d.length-250));}" | Out-Host
