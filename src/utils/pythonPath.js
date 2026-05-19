const fs = require('fs');
const path = require('path');

function resolvePythonPath(baseDir = path.join(__dirname, '../..')) {
  if (process.env.PYTHON_PATH) return process.env.PYTHON_PATH;

  if (process.platform === 'win32') {
    return path.join(process.env.LOCALAPPDATA || '', 'Programs', 'Python', 'Python312', 'python.exe');
  }

  const projectPython = path.join(baseDir, '.conda-envs/rag/bin/python3.10');
  if (fs.existsSync(projectPython)) return projectPython;

  return 'python3';
}

module.exports = { resolvePythonPath };
