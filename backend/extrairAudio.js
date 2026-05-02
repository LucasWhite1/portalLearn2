const ffmpeg = require('fluent-ffmpeg');
const ffmpegPath = require('ffmpeg-static');

ffmpeg.setFfmpegPath(ffmpegPath);

ffmpeg('CLT.mp4')
  .noVideo()
  .audioCodec('libmp3lame')
  .audioBitrate(192)
  .save('audio.mp3')
  .on('end', () => console.log('Áudio extraído!'))
  .on('error', err => console.error(err));