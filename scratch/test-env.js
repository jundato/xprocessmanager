
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

// Mimic server.js path logic
['/usr/local/bin', '/opt/homebrew/bin'].forEach(dir => {
  if (fs.existsSync(dir) && !process.env.PATH.split(':').includes(dir)) {
    process.env.PATH = dir + ':' + process.env.PATH;
  }
});

console.log('Current PATH:', process.env.PATH);

const proc = spawn('pwsh', ['-c', 'echo "PWSH PATH: $env:PATH"; which dotnet'], {
  env: process.env
});

proc.stdout.on('data', (data) => console.log('STDOUT:', data.toString()));
proc.stderr.on('data', (data) => console.error('STDERR:', data.toString()));
proc.on('close', (code) => console.log('Exited with code:', code));
