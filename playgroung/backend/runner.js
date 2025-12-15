const { spawn } = require('child_process');

function runTest(file) {
  return new Promise((resolve) => {
    const process = spawn(
      'npx',
      ['playwright', 'test', file],
      { shell: true }
    );

    let output = '';

    process.stdout.on('data', data => {
      output += data.toString();
    });

    process.stderr.on('data', data => {
      output += data.toString();
    });

    process.on('close', () => {
      resolve(output);
    });
  });
}

module.exports = { runTest };
