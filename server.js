const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const fs = require('fs-extra');
const path = require('path');
const { spawn } = require('child_process');
const os = require('os');
require('dotenv').config();

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: { origin: '*', methods: ['GET', 'POST'] }
});

// Configuration
const PORT = process.env.PORT || 3000;
const SCRIPTS_DIR = path.join(__dirname, process.env.SCRIPTS_DIR || './scripts');
const DATABASE_DIR = path.join(__dirname, process.env.DATABASE_DIR || './database');
const ASSETS_DIR = path.join(__dirname, process.env.ASSETS_DIR || './assets');

// Ensure directories exist
[SCRIPTS_DIR, DATABASE_DIR, ASSETS_DIR].forEach(dir => {
  fs.ensureDirSync(dir);
});

// Track running processes
const runningProcesses = {};

// Middleware
app.use(express.static('public'));
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

// Serve dashboard
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'dashboard.html'));
});

// API: Get all scripts
app.get('/api/scripts', (req, res) => {
  try {
    const scripts = fs.readdirSync(SCRIPTS_DIR).filter(file => 
      file.endsWith('.js') || file.endsWith('.py')
    );
    res.json({ success: true, scripts, count: scripts.length });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// API: Get system status
app.get('/api/status', (req, res) => {
  const cpuUsage = os.loadavg()[0];
  const memoryUsage = (os.totalmem() - os.freemem()) / os.totalmem() * 100;
  const uptime = Math.floor(process.uptime());
  
  res.json({
    success: true,
    cpu: cpuUsage.toFixed(2),
    memory: memoryUsage.toFixed(2),
    uptime,
    processes: Object.keys(runningProcesses).length
  });
});

// API: Upload file
app.post('/api/upload', (req, res) => {
  try {
    const { filename, content, type } = req.body;
    if (!filename || !content) {
      return res.status(400).json({ success: false, error: 'Missing filename or content' });
    }

    let targetDir = SCRIPTS_DIR;
    if (type === 'database') targetDir = DATABASE_DIR;
    else if (type === 'assets') targetDir = ASSETS_DIR;

    const filePath = path.join(targetDir, filename);
    fs.writeFileSync(filePath, content);
    
    res.json({ success: true, message: 'File uploaded successfully', file: filename });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// API: Delete file
app.delete('/api/file/:filename', (req, res) => {
  try {
    const filename = req.params.filename;
    const filePath = path.join(SCRIPTS_DIR, filename);
    
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ success: false, error: 'File not found' });
    }
    
    fs.removeSync(filePath);
    res.json({ success: true, message: 'File deleted successfully' });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// API: Read file
app.get('/api/file/:filename', (req, res) => {
  try {
    const filename = req.params.filename;
    const filePath = path.join(SCRIPTS_DIR, filename);
    
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ success: false, error: 'File not found' });
    }
    
    const content = fs.readFileSync(filePath, 'utf-8');
    res.json({ success: true, content, filename });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Socket.IO Events
io.on('connection', (socket) => {
  console.log(`[${new Date().toISOString()}] Client connected: ${socket.id}`);

  // Start script execution
  socket.on('startScript', (scriptName) => {
    console.log(`[${new Date().toISOString()}] Starting script: ${scriptName}`);
    
    if (runningProcesses[scriptName]) {
      socket.emit('error', { message: 'Script is already running' });
      return;
    }

    const scriptPath = path.join(SCRIPTS_DIR, scriptName);
    if (!fs.existsSync(scriptPath)) {
      socket.emit('error', { message: 'Script file not found' });
      return;
    }

    try {
      let process;
      if (scriptName.endsWith('.js')) {
        process = spawn('node', [scriptPath]);
      } else if (scriptName.endsWith('.py')) {
        process = spawn('python3', [scriptPath]);
      } else {
        socket.emit('error', { message: 'Unsupported file type' });
        return;
      }

      runningProcesses[scriptName] = process;
      io.emit('processStatus', { script: scriptName, status: 'running', pid: process.pid });

      // Capture stdout
      process.stdout.on('data', (data) => {
        io.emit('scriptLog', { script: scriptName, log: data.toString(), type: 'stdout' });
      });

      // Capture stderr
      process.stderr.on('data', (data) => {
        io.emit('scriptLog', { script: scriptName, log: data.toString(), type: 'stderr' });
      });

      // Handle process exit
      process.on('exit', (code) => {
        delete runningProcesses[scriptName];
        io.emit('processStatus', { script: scriptName, status: 'stopped', code });
        console.log(`[${new Date().toISOString()}] Script exited: ${scriptName} (code: ${code})`);
      });

      process.on('error', (error) => {
        io.emit('scriptLog', { script: scriptName, log: `Error: ${error.message}`, type: 'error' });
      });

    } catch (error) {
      socket.emit('error', { message: error.message });
    }
  });

  // Stop script execution
  socket.on('stopScript', (scriptName) => {
    console.log(`[${new Date().toISOString()}] Stopping script: ${scriptName}`);
    
    if (runningProcesses[scriptName]) {
      runningProcesses[scriptName].kill('SIGTERM');
      setTimeout(() => {
        if (runningProcesses[scriptName]) {
          runningProcesses[scriptName].kill('SIGKILL');
        }
      }, 5000);
      
      socket.emit('success', { message: 'Script stopped' });
    } else {
      socket.emit('error', { message: 'Script is not running' });
    }
  });

  // Restart script
  socket.on('restartScript', (scriptName) => {
    console.log(`[${new Date().toISOString()}] Restarting script: ${scriptName}`);
    
    if (runningProcesses[scriptName]) {
      runningProcesses[scriptName].kill('SIGTERM');
      setTimeout(() => socket.emit('startScript', scriptName), 1000);
    } else {
      socket.emit('startScript', scriptName);
    }
  });

  // Get script output
  socket.on('getStatus', () => {
    const status = Object.keys(runningProcesses).map(script => ({
      script,
      pid: runningProcesses[script].pid,
      status: 'running'
    }));
    socket.emit('allProcessStatus', status);
  });

  socket.on('disconnect', () => {
    console.log(`[${new Date().toISOString()}] Client disconnected: ${socket.id}`);
  });
});

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('[SHUTDOWN] Terminating all processes...');
  Object.values(runningProcesses).forEach(proc => proc.kill());
  server.close(() => process.exit(0));
});

// Start server
server.listen(PORT, () => {
  console.log(`[${new Date().toISOString()}] 🚀 Control Panel running on http://localhost:${PORT}`);
  console.log(`Scripts directory: ${SCRIPTS_DIR}`);
  console.log(`Database directory: ${DATABASE_DIR}`);
  console.log(`Assets directory: ${ASSETS_DIR}`);
});