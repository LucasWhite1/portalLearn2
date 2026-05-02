const { exec } = require('child_process');
const path = require('path');

function transcreverAudio(nomeArquivo) {
  return new Promise((resolve, reject) => {
    const whisperPath = path.resolve(__dirname, 'whisper.cpp/build/bin/whisper-cli.exe');
    const modelPath = path.resolve(__dirname, 'whisper.cpp/models/ggml-base.bin');
    const audioPath = path.resolve(__dirname, nomeArquivo);

    exec(`"${whisperPath}" -m "${modelPath}" -f "${audioPath}" -l pt`, (err, stdout, stderr) => {
      if (err) {
        console.error("STDERR:", stderr);
        return reject(err);
      }
      console.log("STDOUT:", stdout);
      resolve(stdout);
    });
  });
}

transcreverAudio('download.mp3');