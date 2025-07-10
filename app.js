const express = require('express');
const path = require('path');
const fs = require('fs');
const { exec } = require('child_process');
const { execSync } = require('child_process');
const session = require('express-session');
const multer = require('multer');
const ffmpegPath = require('ffmpeg-static');
const { v4: uuidv4 } = require('uuid');
const app = express();
const PORT = 3000;
const DOWNLOADS_FOLDER = path.join(__dirname, 'downloads');
const historialesPorUsuario = {};
const historialesPorUsuarioConvert = {};
const progresoPorUsuario = {};
let clients = [];
let clientsPorDescarga = [];
// 📁 Ruta base para archivos
const UPLOAD_BASE = path.join(__dirname, 'temporal');
app.use(session({
  secret: 'clave-secreta-supersegura',
  resave: false,
  saveUninitialized: true
}));
app.use(express.static(path.join(__dirname, 'public')));
app.use((req, res, next) => {
  if (!req.session.userId) {
    req.session.userId = Date.now() + '-' + Math.floor(Math.random() * 1000);
  }
  next();
});

if (!fs.existsSync(DOWNLOADS_FOLDER)) {
  fs.mkdirSync(DOWNLOADS_FOLDER, { recursive: true });
}
app.use(express.json());
app.set('view engine', 'ejs');
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static('public'));

// SSE: progreso
app.get('/progress', (req, res) => {
  const userId = req.session.userId;
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  if (!clients[userId]) {
    clients[userId] = []
  }
  clients[userId].push(res)

  req.on('close', () => {
    clients[userId] = clients[userId].filter(client => client !== res);
  });
});

function broadcastProgress(userId, percent) {
  const cliente = clients[userId] || [];
  for (const client of cliente) {
    client.write(`data: ${percent}\n\n`);
  }
}

function nombreParaDescarga(nombre) {
  return nombre.replace(/[<>:"/\\|?*\u0000-\u001F]/g, '_').trim();
}

// Página principal: historial del usuario
app.get('/', (req, res) => {
  const historial = historialesPorUsuario[req.session.userId] || [];
  res.render('index', { historial });
});
app.get('/convertidor', (req, res) => {
  const historial = historialesPorUsuarioConvert[req.session.userId] || [];
  crearCarpetaUsuario(req.session.userId);
  res.render('convertidor', { historial });
})
function nombreArchivo(redSoc, id) {
  if (redSoc === 'facebook') {
    var nombre = 'videoDeFacebook' + id;
    nombre += Math.floor(Math.random(99 - 10 + 1) + 1);
    return nombre
  } else if (redSoc === 'X') {
    var nombre = 'videoDeX' + id;
    nombre += Math.floor(Math.random(99 - 10 + 1) + 1);
    return nombre
  }
}
function extraerIdYouTube(url) {
  const regex = /(?:youtube\.com\/.*v=|youtu\.be\/)([^&]+)/;
  const match = url.match(regex);
  return match ? match[1] : null;
}
const axios = require('axios');
async function obtenerTitulo(url) {
  const apiKey = 'AIzaSyDPWDqVQjJ_tlCZU9QyWG73aHPHfkUMnms';
  let videoId;

  try {
    // Extraer el ID correctamente
    if (url.includes('youtu.be')) {
      const u = new URL(url);
      videoId = u.pathname.replace('/', '');
    } else {
      videoId = extraerIdYouTube(url); // Debes tener esta función implementada
    }

    const urlApi = `https://www.googleapis.com/youtube/v3/videos?id=${videoId}&part=snippet&key=${apiKey}`;
    const res = await axios.get(urlApi);
    const datos = res.data;

    if (datos.items && datos.items.length > 0) {
      return datos.items[0].snippet.title;
    } else {
      throw new Error('Video no encontrado');
    }
  } catch (err) {
    console.error('❌ Error al obtener título:', err.message);
    return null;
  }
}

function limpiarNombreArchivo(nombre) {
  return nombre
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, '_') // caracteres inválidos
    .replace(/[\p{Emoji_Presentation}\p{Extended_Pictographic}]/gu, '') // emojis
    .replace(/[^\x00-\x7F]/g, '') // no-ASCII
    .trim();
}
// Ruta de descarga (yt-dlp)
app.post('/download', async (req, res) => {
  const { url, format, titulo } = req.body;
  const userId = req.session.userId;
  const isMp3 = format === 'mp3';
  const cleanUrl = url.split('&')[0];
  console.log(cleanUrl);
  let outputPath;

  if (url.includes('facebook.com')) {
    outputPath = titulo ? `${DOWNLOADS_FOLDER}/${limpiarNombreArchivo(titulo)}` : `${DOWNLOADS_FOLDER}/${nombreArchivo('facebook', userId)}`;
  } else if (url.includes('x.com')) {
    outputPath = titulo ? `${DOWNLOADS_FOLDER}/${limpiarNombreArchivo(titulo)}` : `${DOWNLOADS_FOLDER}/${nombreArchivo('X', userId)}`;
  } else if (url.includes('youtube.com') || url.includes('youtu.be')) {
    if (titulo) {
      outputPath = `${DOWNLOADS_FOLDER}/${titulo}`;
    } else {
      var tituloB;
      if (url.includes('youtu.be')) {
        tituloB = await obtenerTitulo(url);
        console.log('obtiene= ' + tituloB)
      } else {
        tituloB = await obtenerTitulo(cleanUrl);
      }
      console.log(tituloB);
      outputPath = `${DOWNLOADS_FOLDER}/${limpiarNombreArchivo(tituloB)}`;
    }
  } else {
    outputPath = titulo ? `${DOWNLOADS_FOLDER}/${titulo}.%(ext)s` : `${DOWNLOADS_FOLDER}/%(title)s.%(ext)s`;
  }

  let args = [];
  if (isMp3) {
    args = ['--extract-audio', '--audio-format', 'mp3', '--audio-quality', '0', '-o', outputPath, '--restrict-filenames', '--no-playlist', cleanUrl];
  } else if (url.includes('dailymotion.com')) {
    args = ['-o', outputPath, '--no-playlist', '--restrict-filenames', cleanUrl];
  } else if (url.includes('youtube.com') || url.includes('youtu.be') || url.includes('facebook.com') || url.includes('x.com')) {
    console.log('youtube, facebook o X')
    args = ['-f', 'bestvideo+bestaudio', '-o', outputPath, '--no-playlist', '--restrict-filenames', cleanUrl];
  } else {
    args = ['-o', outputPath, '--restrict-filenames', cleanUrl];
  }

  console.log('🟢 Ejecutando:', 'yt-dlp', args.join(' '));

  let archivoFinal = '';
  let archivoSinExtension = '';

  const proceso = spawn('yt-dlp', args);

  proceso.stdout.on('data', (data) => {
    const lines = data.toString().split('\n');
    for (const line of lines) {
      console.log(line);
      const match = line.match(/\[download\]\s+(\d+(?:\.\d+)?)%/);
      if (match) {
        const percent = parseFloat(match[1]);
        broadcastProgress(userId, percent);
      }

      const destMatch = line.match(/\[download\] Destination: (.+)/);
      if (destMatch) {
        archivoFinal = path.basename(destMatch[1].trim());
        archivoSinExtension = archivoFinal.replace(/\.[^/.]+$/, '');
      }
    }
  });

  proceso.stderr.on('data', (data) => {
    console.error('[yt-dlp error]', data.toString());
  });

  proceso.on('close', (code) => {
    function limpiarNombreArchivo(nombre) {
      return nombre
        .replace(/[<>"/\\|?*\u0000-\u001F]/g, '_')
        .replace(/[\p{Emoji_Presentation}\p{Extended_Pictographic}]/gu, '')
        .replace(/[^\x00-\x7F]/g, '')
        .trim();
    }

    if (code === 0) {
      broadcastProgress(userId, 100);
      setTimeout(() => (clients = []), 1000);
      var baseName;

      // Quita ID de calidad, fragmento o stream
      var tituloLimpio;
      ext = archivoFinal.split('.').pop();
      if (format === 'mp3') {
        ext = 'mp3';
        tituloLimpio = archivoSinExtension;
        console.log(tituloLimpio);
      } else {
        baseName = archivoSinExtension.replace(/\.[^/.]+$/, '');

        // Quita ID de calidad, fragmento o stream
        tituloLimpio = baseName
          .replace(/(\.f\d+|\.mp4|\.webm|\.m4a|\.mkv|\.flv|\.mov|\.avi|\.ts|\.aac|\.opus|\.mp3|\.mpg|\.mpeg)$/i, '')
          .replace(/[<>“”"|?*\/\\]/g, '') // elimina caracteres peligrosos
          .replace(/[\p{Emoji_Presentation}\p{Extended_Pictographic}]/gu, '') // elimina emojis
          .trim();
        console.log('tituloLimpio: ', tituloLimpio);
        console.log('archivo sin extension: ' + archivoSinExtension)
        console.log('archivoFinal= ' + archivoFinal)
      }
      console.log(ext);

      const item = {
        archivoOriginal: tituloLimpio + '.' + ext,
        archivoConvertido: tituloLimpio + '.' + ext,
        nombreDescarga: tituloLimpio + '.' + ext,
        titulo: tituloLimpio,
        formato: format,
        fecha: new Date().toLocaleString('es-MX')
      };

      if (!historialesPorUsuario[req.session.userId]) {
        historialesPorUsuario[req.session.userId] = [];
      }
      historialesPorUsuario[req.session.userId].unshift(item);
      console.log(archivoFinal);
      return res.json({ success: true, archivo: archivoFinal, titulo: tituloLimpio });
    } else {
      return res.status(500).json({ error: 'Error al descargar' });
    }
  });
});

app.get('/progress-descarga', (req, res) => {
  const userId = req.session.userId;
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();
  if (!clientsPorDescarga[userId]) {
    clientsPorDescarga[userId] = [];
  }
  clientsPorDescarga[userId].push(res);

  req.on('close', () => {
    clientsPorDescarga[userId] = clientsPorDescarga[userId].filter(client => client !== res);
  });

});
function broadcastProgressDescarga(userId, percent) {
  const clientes = clientsPorDescarga[userId] || [];
  for (const client of clientes) {
    client.write(`data: ${percent}\n\n`);
  }
}
const { spawn } = require('child_process');
// Descargar archivo del historial (protección por sesión)

function obtenerExtension(nombreArchivo) {
  const extMatch = nombreArchivo.match(/\.([a-z0-9]+)$/i);
  return extMatch ? extMatch[1].toLowerCase() : '';
}

app.get('/descargar/:archivo', async (req, res) => {
  const archivoSolicitado = decodeURIComponent(req.params.archivo);
  const userId = req.session.userId;
  const historial = historialesPorUsuario[userId] || [];
  const item = historial.find(i => i.nombreDescarga === archivoSolicitado);
  const originalPath = path.join(DOWNLOADS_FOLDER, item.archivoOriginal);
  const extOriginal = item.archivoOriginal.split('.').pop();
  console.log(extOriginal)
  console.log('extOriginal: ' + extOriginal);
  console.log(originalPath);
  // Si ya está convertido
  if (['mp4', 'mp3'].includes(extOriginal)) {
    console.log('entra en mp4 o mp3');
    const rutaConvertida = path.join(DOWNLOADS_FOLDER, archivoSolicitado);
    console.log(item.nombreDescarga);
    console.log(archivoSolicitado);
    const salida = extOriginal === 'mp3' ? 'audio/mpeg' : 'video/mp4';
    console.log(rutaConvertida);
    res.setHeader('Content-Type', salida);
    res.setHeader('Content-Disposition', `attachment; filename="${item.nombreDescarga}"`);
    return res.sendFile(rutaConvertida);
  }

  // Si ya está en sesión listo
  if (req.session.archivoDescargar === archivoSolicitado) {
    const rutaConvertida = path.join(DOWNLOADS_FOLDER, archivoSolicitado);
    console.log(rutaConvertida)
    res.setHeader('Content-Type', 'video/mp4');
    return res.download(rutaConvertida);
  }

  // Si ya está convirtiendo
  if (req.session.conversionEnProgreso) {
    return res.json({ estado: 'convirtiendo' });
  }

  // Iniciar conversión
  req.session.conversionEnProgreso = true;

  convertir(originalPath, item.archivoOriginal, userId, porcentaje => {
    broadcastProgressDescarga(userId, porcentaje);
  }).then(rutaConvertida => {
    console.log('Ruta ya convertida= ' + rutaConvertida);

    req.session.archivoDescargar = path.basename(rutaConvertida); // solo nombre del archivo
    req.session.nombreDescarga = archivoSolicitado;
    req.session.conversionEnProgreso = false;
    console.log('datos ' + req.session.archivoDescargar + ' ' + req.session.nombreDescarga + ' ' + req.session.conversionEnProgreso)
    console.log('✅ Conversión lista');
    req.session.save(err => {
      if (err) {
        console.error('❌ Error al guardar sesión:', err);
      } else {
        console.log('✅ Sesión guardada correctamente');
      }
    });
  }).catch(err => {
    console.error('❌ Conversión fallida:', err);
    req.session.conversionEnProgreso = false;
    req.session.save();
  });

  return res.json({ estado: 'convirtiendo' });
});

app.get('/descargar-final/:archivo', (req, res) => {
  const archivo = decodeURIComponent(req.params.archivo);
  const archivoDescargar = req.session.archivoDescargar;
  const userId = req.session.userId;
  console.log('datos finales= ' + archivoDescargar + ' ' + userId);

  if (req.session.archivoDescargar !== archivoDescargar) {
    return res.status(400).json({ error: 'Archivo aún no disponible' });
  }

  const filePath = path.join(DOWNLOADS_FOLDER, archivoDescargar);
  if (!fs.existsSync(filePath)) {
    return res.status(404).send('Archivo convertido no encontrado.');
  }
  res.setHeader('Content-Disposition', `attachment; filename="${archivoDescargar}"`);
  res.setHeader('Content-Type', 'video/mp4');
  return res.download(filePath, archivoDescargar, err => {
    if (err) console.error('❌ Error al enviar el archivo:', err.message);
  });
});
var cont = 0;
app.get('/conversion-estado', (req, res) => {
  console.log(cont + ' ' + req.session.archivoDescargar + ' ' + req.session.nombreDescarga + ' ' + req.session.conversionEnProgreso);
  cont++;
  if (req.session.archivoDescargar && req.session.nombreDescarga && !req.session.conversionEnProgreso) {
    console.log('entra')
    return res.json({ estado: 'listo' });
  } else if (req.session.conversionEnProgreso) {
    return res.json({ estado: 'convirtiendo' });
  } else {
    return res.json({ estado: 'error' });
  }
});


function convertir(inputPath, archivoOriginal, userId, onProgress = () => { }) {
  return new Promise((resolve, reject) => {
    const nombreSalida = `${path.basename(archivoOriginal, path.extname(archivoOriginal))}.mp4`;
    console.log('nombre salida= ' + nombreSalida);
    const outputPath = path.join(DOWNLOADS_FOLDER, nombreSalida);

    const args = [
      '-y',
      '-i', inputPath,
      '-c:v', 'libx264',
      '-profile:v', 'baseline',
      '-level', '3.0',
      '-b:v', '1M',
      '-c:a', 'aac',
      '-ac', '2',
      '-b:a', '128k',
      outputPath
    ];

    const ffmpeg = spawn('ffmpeg', args);

    let duracionTotal = 0;

    ffmpeg.stderr.on('data', data => {
      const str = data.toString();

      // Extraer duración del video (una sola vez)
      const durMatch = str.match(/Duration: (\d+):(\d+):(\d+\.\d+)/);
      if (durMatch && duracionTotal === 0) {
        const horas = parseInt(durMatch[1]);
        const minutos = parseInt(durMatch[2]);
        const segundos = parseFloat(durMatch[3]);
        duracionTotal = horas * 3600 + minutos * 60 + segundos;
      }

      // Extraer progreso actual
      const timeMatch = str.match(/time=(\d+):(\d+):(\d+\.\d+)/);
      if (timeMatch && duracionTotal > 0) {
        const horas = parseInt(timeMatch[1]);
        const minutos = parseInt(timeMatch[2]);
        const segundos = parseFloat(timeMatch[3]);
        const tiempoActual = horas * 3600 + minutos * 60 + segundos;

        const porcentaje = Math.min(Math.round((tiempoActual / duracionTotal) * 100), 100);
        onProgress(porcentaje); // Callback al frontend
      }
    });

    ffmpeg.on('error', err => {
      console.error('❌ Error al ejecutar FFmpeg:', err);
      reject('Error al ejecutar FFmpeg');
    });

    ffmpeg.on('close', code => {
      if (code === 0) {
        // Eliminar el original
        const rutaOriginal = path.join(DOWNLOADS_FOLDER, archivoOriginal);
        if (fs.existsSync(rutaOriginal)) {
          setTimeout(() => {
            try {
              fs.unlinkSync(rutaOriginal);
              console.log(`🗑️ Archivo eliminado: ${rutaOriginal}`);
            } catch (err) {
              console.error('❌ No se pudo eliminar el archivo:', err.message);
            }
          }, 1000); // Espera 1 segundo para asegurarte que FFmpeg lo haya soltado
        }

        // Actualizar item en historial
        const historial = historialesPorUsuario[userId] || [];
        const item = historial.find(i => i.archivoOriginal === archivoOriginal);
        if (item) {
          item.archivoOriginal = nombreSalida;
          item.archivoConvertido = nombreSalida;
          item.nombreDescarga = nombreSalida;
          item.formato = 'mp4';
        }
        console.log('salida convertido= ' + outputPath);
        resolve(outputPath);
      } else {
        reject('Error en la conversión');
      }
    });
  });
}
function obtenerExtension(nombreArchivo) {
  const extMatch = nombreArchivo.match(/\.([a-z0-9]+)(?:\.[a-z0-9]+)?$/i);
  return extMatch ? extMatch[1].toLowerCase() : '';
}

// Historial JSON por usuario
app.get('/historial-archivos', (req, res) => {
  const historial = historialesPorUsuario[req.session.userId] || [];
  res.json(historial);
});
app.post('/eliminar', (req, res) => {
  const { archivo } = req.body;
  const userId = req.session.userId;
  console.log(archivo);
  if (!archivo) {
    return res.status(400).json({ error: 'Archivo no especificado.' });
  }

  const historial = historialesPorUsuario[userId] || [];

  const index = historial.findIndex(item => item.archivoConvertido === archivo);
  if (index === -1) {
    return res.status(403).json({ error: 'No tienes permiso para eliminar este archivo.' });
  }

  const ruta = path.join(DOWNLOADS_FOLDER, archivo);
  if (fs.existsSync(ruta)) {
    try {
      fs.unlinkSync(ruta);
    } catch (err) {
      console.error('❌ Error eliminando el archivo:', err);
      return res.status(500).json({ error: 'Error eliminando el archivo.' });
    }
  }

  // Eliminar del historial del usuario
  historialesPorUsuario[userId].splice(index, 1);

  res.json({ success: true });
});
app.get('/descargar-convertido', (req, res) => {
  const ruta = req.session.archivoDescargar;
  const nombre = req.session.nombreDescarga;
  if (!ruta || !fs.existsSync(ruta)) {
    return res.status(400).send('Archivo no listo aún.');
  }

  return res.download(ruta, nombre, err => {
    if (err) {
      console.error('❌ Error al descargar convertido:', err.message);
    } else {
      console.log('✅ Descarga enviada correctamente');
      // Limpieza opcional:
      delete req.session.archivoDescargar;
      delete req.session.nombreDescarga;
    }
  });
});
// Middleware para crear carpetas por usuario
function crearCarpetaUsuario(userId) {
  const carpeta = path.join(UPLOAD_BASE, userId);
  if (!fs.existsSync(carpeta)) fs.mkdirSync(carpeta, { recursive: true });
  return carpeta;
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const userId = req.session.userId || 'anon';
    const carpetaUsuario = crearCarpetaUsuario(userId);
    cb(null, carpetaUsuario);
  },
  filename: (req, file, cb) => {
    cb(null, 'original' + path.extname(file.originalname));
  }
});

const upload = multer({ storage });

// Convertir archivo
app.post('/convertir-archivo', upload.single('archivo'), async (req, res) => {
  const archivo = req.file;
  const formato = req.body.formato;
  const sesion = req.session;
  const idUnico = sesion.userId;
  const carpetaUsuario = path.join(UPLOAD_BASE, idUnico);

  const archivoEntrada = archivo.path;
  const nombreSalida = `convertido.${formato}`;
  const rutaSalida = path.join(carpetaUsuario, nombreSalida);
  sesion.rutaConvertida = rutaSalida;
  let duracionTotal = 0;

  crearCarpetaUsuario(idUnico);

  try {
    const duracionStr = execSync(`ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${archivoEntrada}"`);
    duracionTotal = parseFloat(duracionStr.toString().trim());
  } catch (err) {
    console.error('❌ Error al obtener duración:', err.message);
  }

  let args = ['-y', '-i', archivoEntrada];
  if (req.body.resolucion) args.push('-vf', `scale=-1:${req.body.resolucion}`);
  if (req.body.bitrateVideo) args.push('-b:v', req.body.bitrateVideo);
  if (req.body.bitrateAudio) args.push('-b:a', req.body.bitrateAudio);
  if (req.body.calidadImagen) args.push('-qscale:v', Math.round(31 - req.body.calidadImagen / 3.3));
  args.push(rutaSalida);

  const ffmpeg = spawn('ffmpeg', args);
  progresoPorUsuario[idUnico] = 0;

  ffmpeg.stderr.on('data', (data) => {
    const str = data.toString();
    const match = str.match(/time=(\d+):(\d+):(\d+).(\d+)/);
    if (match && duracionTotal > 0) {
      const [_, h, m, s, ms] = match.map(Number);
      const tiempoActual = h * 3600 + m * 60 + s + (ms / 100);
      const porcentaje = Math.min(100, Math.round((tiempoActual / duracionTotal) * 100));
      progresoPorUsuario[idUnico] = porcentaje;
    } else {
      sesion.progress = Math.min(sesion.progress + 1, 95);
    }
  });

  ffmpeg.on('close', () => {
    progresoPorUsuario[idUnico] = 100;
  });

  res.sendStatus(200);
});

// Progreso de conversión SSE
app.get('/progreso-conversion', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  const interval = setInterval(() => {
    const userId = req.session.userId;
    const percent = progresoPorUsuario[userId] || 0;
    res.write(`data: ${percent}\n\n`);
    if (percent >= 100) clearInterval(interval);
  }, 1000);
});

// Descargar archivo convertido y limpiar carpeta
// 🔁 Limpieza periódica de carpetas temporales inactivas
const LIMPIEZA_CADA_MINUTOS = 30;
const MAX_INACTIVIDAD_MS = 60 * 60 * 1000; // 1 hora

setInterval(() => {
  const ahora = Date.now();

  fs.readdir(UPLOAD_BASE, (err, carpetas) => {
    if (err) return console.error('❌ Error leyendo carpetas temporales:', err);

    carpetas.forEach(carpeta => {
      const ruta = path.join(UPLOAD_BASE, carpeta);

      fs.stat(ruta, (err, stats) => {
        if (err) return;

        const inactivo = ahora - stats.mtimeMs > MAX_INACTIVIDAD_MS;
        if (inactivo) {
          fs.rm(ruta, { recursive: true, force: true }, err => {
            if (err) {
              console.error('❌ Error eliminando carpeta inactiva:', ruta);
            } else {
              console.log('🗑️ Carpeta eliminada por inactividad:', ruta);
            }
          });
        }
      });
    });
  });
}, LIMPIEZA_CADA_MINUTOS * 60 * 1000);

const limpiezaDownloadsMinutos = 60; // Ejecutar cada 60 minutos
const MaxActividadDownloads = 60 * 60 * 1000; // 1 hora en milisegundos

setInterval(() => {
  const now = Date.now();
  fs.readdir(DOWNLOADS_FOLDER, (err, archivos) => {
    if (err) {
      console.error(`❌ Error al leer el directorio: ${err.message}`);
      return;
    }

    archivos.forEach((archivo) => {
      const ruta = path.join(DOWNLOADS_FOLDER, archivo);
      fs.stat(ruta, (err, stats) => {
        if (err) return;

        const inactivo = now - stats.mtimeMs > MaxActividadDownloads;
        if (inactivo) {
          fs.rm(ruta, { recursive: true, force: true }, (err) => {
            if (err) {
              console.error('❌ Error eliminando archivo inactivo:', ruta);
            } else {
              console.log('🗑️ Archivo eliminado por inactividad:', ruta);
            }
          });
        }
      });
    });
  });
}, limpiezaDownloadsMinutos * 60 * 1000); // Ejecuta cada N minutos

const mime = require('mime-types'); // Asegúrate de instalarlo con: npm install mime-types

app.get('/descargar-archivo-convertido', (req, res) => {
  const ruta = req.session.rutaConvertida;

  if (!ruta || !fs.existsSync(ruta)) {
    return res.status(404).send('No encontrado');
  }

  // Obtener nombre y tipo MIME
  const nombre = path.basename(ruta);
  const mimeType = mime.lookup(nombre) || 'application/octet-stream';

  // Establecer headers adecuados
  res.setHeader('Content-Type', mimeType);
  res.setHeader('Content-Disposition', `attachment; filename="${nombre}"`);

  // Enviar el archivo
  res.download(ruta, nombre, err => {
    if (!err) {
      try {
        fs.unlinkSync(ruta); // Elimina el archivo convertido
        const carpeta = path.dirname(ruta);
        fs.rmdirSync(carpeta, { recursive: true }); // Elimina la carpeta del usuario
      } catch (error) {
        console.error('❌ Error al limpiar archivos:', error.message);
      }
    } else {
      console.error('❌ Error al enviar el archivo convertido:', err.message);
    }
  });
});


app.listen(PORT, '192.168.100.27', () => {
  console.log(`🚀 Servidor activo en http://192.168.100.27:${PORT}`);
});
