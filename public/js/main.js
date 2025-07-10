// Escuchar evento submit del formulario

const downloadForm = document.getElementById('downloadForm');
const urlInput = document.getElementById('url');
const formatSelect = document.getElementById('format');
const progressContainer = document.getElementById('progressContainer');
const progressBar = document.getElementById('progressBar');
const result = document.getElementById('result');
const historialList = document.getElementById('historialList');

// Enviar formulario

downloadForm.addEventListener('submit', async function (e) {
  e.preventDefault();
  cargarHistorial();
  const url = urlInput.value.trim();
  const format = formatSelect.value;
  const titulo = document.getElementById('titulo').value;

  progressContainer.style.display = 'block';
  progressBar.style.width = '0%';
  progressBar.innerText = '0%';
  result.innerHTML = '';

  const eventSource = new EventSource('/progress');

  eventSource.onmessage = e => {
    const percent = parseFloat(e.data);
    progressBar.style.width = `${percent}%`;
    progressBar.innerText = `${percent}%`;
    if (percent >= 100) {
      eventSource.close();
    }
  };
  if (titulo.includes('.')) {
    titulo = titulo.split('.')[0];
  }

  try {
    const response = await fetch('/download', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url, format, titulo })
    });

    const data = await response.json();

    if (data.success) {
      cargarHistorial();
      setTimeout(() => {
        progressContainer.style.display = 'none';
        progressBar.style.width = '0%';
        progressBar.innerText = '0%';
      }, 1500);

    } else {
      result.innerHTML = `<div class="alert alert-danger">${data.error}</div>`;
    }
  } catch (err) {
    result.innerHTML = `<div class="alert alert-danger">Error al contactar al servidor.</div>`;
  }

  urlInput.value = '';
});



// Cargar historial al inicio

async function cargarHistorial() {
  const historialList = document.getElementById('historialList');
  historialList.innerHTML = '';

  try {
    const res = await fetch('/historial-archivos');
    const archivos = await res.json();

    if (archivos.length === 0) {
      historialList.innerHTML = '<li class="list-group-item text-center text-muted">No hay descargas todavía.</li>';
      return;
    }

    archivos.forEach(({ archivo, titulo, fecha, formato, nombreDescarga }) => {
      const li = document.createElement('li');
      li.className = 'list-group-item d-flex justify-content-between align-items-center';
      li.setAttribute('data-archivo', archivo);

      li.innerHTML = `
        <div>
          <strong>${titulo}</strong> - <small>${formato.toUpperCase()}</small><br>
          <small class="text-muted">${fecha}</small>
        </div>
        <div>
          <button class="btn btn-primary btn-sm me-2 btnDescargarArchivo" data-nombre="${encodeURIComponent(nombreDescarga)}">Descargar</button>
          <button class="btn btn-danger btn-sm btnEliminarArchivo" data-archivo="${encodeURIComponent(nombreDescarga)}">Eliminar</button>
        </div>
      `;

      historialList.appendChild(li);
    });

  } catch {
    historialList.innerHTML = '<li class="list-group-item text-center text-danger">Error cargando historial.</li>';
  }
}
document.getElementById('historialList').addEventListener('click', async (e) => {
  // Descargar
  if (e.target.classList.contains('btnDescargarArchivo')) {
    const archivo = decodeURIComponent(e.target.dataset.nombre);
    const boton = e.target;
    boton.disabled = true;
    try {
      const res1 = await fetch(`/descargar/${encodeURIComponent(archivo)}`);
      const contentType = res1.headers.get('Content-Type');

      if (contentType && contentType.includes('application/json')) {
        const estado = await res1.json();
        if (estado.estado === 'convirtiendo') {
          alert('Se está convirtiendo el video a mp4, espere por favor');
          return;
        }
      }

      // Si no es JSON, es un archivo directamente descargable
      const blob = await res1.blob();
      const urlBlob = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = urlBlob;
      a.download = archivo.replace(/_/g, ' ');
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(urlBlob);
      boton.disabled = false;

    } catch (error) {
      alert('Ocurrió un error al descargar');
    }

  }

  // Eliminar 
  if (e.target.classList.contains('btnEliminarArchivo')) {
    const boton = e.target;
    const archivo = decodeURIComponent(boton.dataset.archivo);
    if (!confirm('¿Eliminar este archivo?')) return;

    const resp = await fetch('/eliminar', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ archivo }),
    });

    if (resp.ok) {
      cargarHistorial();
    } else {
      alert('Error eliminando archivo.');
    }
  }
});


document.addEventListener('DOMContentLoaded', cargarHistorial);
