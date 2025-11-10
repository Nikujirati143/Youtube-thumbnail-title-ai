const fileInput = document.getElementById('fileInput');
const urlInput = document.getElementById('urlInput');
const generateBtn = document.getElementById('generateBtn');
const thumbsBox = document.getElementById('thumbs');
const fileMeta = document.getElementById('fileMeta');
const preview = document.getElementById('preview');
const output = document.getElementById('output');
const langSelect = document.getElementById('langSelect');
const copyAllBtn = document.getElementById('copyAll');
const downloadJSONBtn = document.getElementById('downloadJSON');

let currentFile = null;
let metadataResult = null;

function fileToURL(f){ return URL.createObjectURL(f); }
function formatTime(s){ const mm=Math.floor(s/60); const ss=Math.floor(s%60); return mm+':'+String(ss).padStart(2,'0'); }

async function extractFrames(file, percentages=[0.12,0.32,0.55,0.75,0.92]){
  return new Promise((resolve, reject)=>{
    const vid = document.createElement('video');
    vid.preload='metadata'; vid.muted=true; vid.playsInline=true; vid.src = fileToURL(file);
    vid.addEventListener('loadedmetadata', async ()=>{
      const duration = vid.duration || 0;
      const canvas = document.createElement('canvas');
      const w = Math.min(640, vid.videoWidth || 640);
      const h = Math.min(360, vid.videoHeight || 360);
      canvas.width = w; canvas.height = h;
      const ctx = canvas.getContext('2d');
      const results = [];
      const captureAt = (t)=> new Promise(res=>{
        vid.currentTime = Math.max(0.05, Math.min(duration-0.05, t));
        const onSeek = ()=>{ ctx.drawImage(vid,0,0,w,h); const data = canvas.toDataURL('image/jpeg',0.85); res({time: vid.currentTime, data}); };
        vid.addEventListener('seeked', onSeek, {once:true});
      });
      (async ()=>{
        for(const p of percentages){
          const t = Math.max(0, Math.min(duration-0.05, duration * p));
          const item = await captureAt(t);
          results.push(item);
        }
        resolve(results);
      })();
    });
    vid.addEventListener('error', e=> reject(e));
  });
}

function renderFrames(frames, baseName){
  thumbsBox.innerHTML='';
  frames.forEach((f, i)=>{
    const c = document.createElement('div'); c.className='thumb';
    const img = document.createElement('img'); img.src = f.data; c.appendChild(img);
    const ov = document.createElement('div'); ov.className='overlay'; ov.innerText = `Frame ${i+1} • ${formatTime(f.time)}`;
    c.appendChild(ov);
    const dl = document.createElement('button'); dl.className='small'; dl.innerText='Download';
    dl.addEventListener('click', ()=> { const a=document.createElement('a'); a.href=f.data; a.download = (baseName||'thumb')+'-'+(i+1)+'.jpg'; document.body.appendChild(a); a.click(); a.remove(); });
    const use = document.createElement('button'); use.className='small'; use.innerText='Use'; use.style.marginLeft='6px';
    use.addEventListener('click', ()=> { preview.innerHTML=''; const img2=new Image(); img2.src=f.data; img2.style.maxWidth='100%'; preview.appendChild(img2); });
    const wrapper = document.createElement('div'); wrapper.style.width='160px';
    wrapper.appendChild(c);
    const row = document.createElement('div'); row.style.marginTop='6px'; row.appendChild(dl); row.appendChild(use);
    wrapper.appendChild(row);
    thumbsBox.appendChild(wrapper);
  });
}

generateBtn.addEventListener('click', async ()=>{
  output.innerText=''; preview.innerText='Processing...';
  let file = null;
  if(fileInput.files && fileInput.files[0]) file = fileInput.files[0];
  else if(urlInput.value.trim()){
    try{
      const resp = await fetch(urlInput.value.trim());
      const blob = await resp.blob();
      file = new File([blob], 'remote-video.mp4', {type: blob.type});
    }catch(e){
      alert('Remote URL failed (CORS). Use file upload for reliable results.');
      preview.innerText='Preview';
      return;
    }
  } else { alert('Please choose a video file or provide a URL.'); preview.innerText='Preview'; return; }

  currentFile = file;
  fileMeta.innerText = `File: ${file.name} • ${(file.size/1024/1024).toFixed(2)} MB`;

  // extract frames to show thumbnails
  try{
    const frames = await extractFrames(file);
    renderFrames(frames, file.name.replace(/\.[^/.]+$/,''));
  }catch(e){ console.warn('frame extract error', e); }

  // preview video
  try{
    const v = document.createElement('video'); v.controls=true; v.src = fileToURL(file); v.style.maxWidth='100%';
    preview.innerHTML=''; preview.appendChild(v);
  }catch(e){ preview.innerText='Preview not available'; }

  // call backend to generate using Groq
  try{
    output.innerText = 'Generating metadata from server (Groq)...';
    const resp = await fetch('/api/generate', {
      method: 'POST',
      headers: {'Content-Type':'application/json'},
      body: JSON.stringify({ filename: file.name, language: langSelect.value })
    });
    const data = await resp.json();
    if(!data.ok){
      // server may return raw content if JSON parse failed
      if(data.raw) output.innerText = data.raw;
      else output.innerText = JSON.stringify(data, null, 2);
      metadataResult = null;
      return;
    }
    metadataResult = data.result;
    output.innerText = JSON.stringify(metadataResult, null, 2);
  }catch(err){
    console.error(err);
    output.innerText = 'Server error: ' + (err.message || err);
  }
});

copyAllBtn.addEventListener('click', ()=>{
  if(!metadataResult){ alert('No metadata to copy'); return; }
  const all = `Titles:\n${(metadataResult.titles||[]).join('\n')}\n\nDescription:\n${metadataResult.description}\n\nTags:\n${(metadataResult.tags||[]).join(', ')}\n\nHashtags:\n${(metadataResult.hashtags||[]).join(' ')}`;
  navigator.clipboard?.writeText(all).then(()=> alert('Copied all metadata')).catch(()=> prompt('Copy manually', all));
});

downloadJSONBtn.addEventListener('click', ()=>{
  if(!metadataResult){ alert('No metadata to download'); return; }
  const blob = new Blob([JSON.stringify(metadataResult, null, 2)], {type:'application/json'});
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = (currentFile?currentFile.name.replace(/\.[^/.]+$/,''):'meta') + '-meta.json'; document.body.appendChild(a); a.click(); a.remove();
});
