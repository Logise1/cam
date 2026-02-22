async function initCore() {
    const ts = Date.now();
    const { initializeApp } = await import(`https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js?t=${ts}`);
    const { getDatabase, ref, set, onValue, remove, onDisconnect } = await import(`https://www.gstatic.com/firebasejs/11.6.1/firebase-database.js?t=${ts}`);

    const firebaseConfig = {
        apiKey: "AIzaSyBs4OlJjJ14WPTQ3u-7VkOjgLKCKQypmTI", authDomain: "aiportal-ce688.firebaseapp.com",
        databaseURL: "https://aiportal-ce688-default-rtdb.europe-west1.firebasedatabase.app", projectId: "aiportal-ce688",
        storageBucket: "aiportal-ce688.firebasestorage.app", messagingSenderId: "217019276864",
        appId: "1:217019276864:web:572d05413bd4ce5fc209a5", measurementId: "G-2XKQPLBHN4"
    };
    const app = initializeApp(firebaseConfig);
    const db = getDatabase(app);

    const UI = {
        red: (estado, msg) => {
            const el = document.getElementById('red-status');
            el.classList.remove('hidden');
            document.getElementById('red-text').innerText = msg;
            const dot = document.getElementById('red-dot');
            dot.className = estado === 'ok' ? "w-2.5 h-2.5 rounded-full bg-emerald-500" : (estado === 'err' ? "w-2.5 h-2.5 rounded-full bg-red-500" : "w-2.5 h-2.5 rounded-full bg-yellow-500 animate-pulse");
            if (estado === 'ok') setTimeout(() => el.classList.add('hidden'), 3000);
        }
    };

    window.App = {
        peer: null, stream: null, wakeLock: null, camaraId: null, miPassword: null,
        lenteActiva: 'environment', mediaCallsActivas: [],

        // MOTOR HÍBRIDO: FOTOS (MJPEG) + AUDIO SYNC
        frameBuffer: [],
        dvrInterval: null,
        dataChannels: [],
        grabandoDVR: false,
        audioRecorder: null,
        currentAudioBase64: null,
        configDVR: { minutos: 1, fps: 5, calidadJpeg: 0.5, maxFrames: 300 },

        // VISOR
        visorCall: null, visorDataConn: null, camaraSeleccionada: null,
        esLive: true, bufferSizeRemoto: 0, fpsRemoto: 5, filtroBrillo: 1,
        dvrPlaybackInterval: null, reproduciendoDvrIndex: -1,
        audioPlayer: new Audio(),

        // --- LÓGICA PWA (Senior Architecture Fallback) ---
        deferredPrompt: null,
        instalarPWA: async () => {
            // Si el navegador capturó el evento estándar
            if (App.deferredPrompt) {
                App.deferredPrompt.prompt();
                const { outcome } = await App.deferredPrompt.userChoice;
                if (outcome === 'accepted') document.getElementById('pwa-install-banner').classList.add('hidden');
                App.deferredPrompt = null;
            } else {
                // FALLBACK: Si es Single-File y Chrome bloquea el evento, mostramos instrucciones manuales
                document.getElementById('modal-instrucciones-pwa').classList.remove('hidden');
            }
        },
        chequearEstadoInstalacion: () => {
            const isStandalone = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone;
            if (!isStandalone) {
                document.getElementById('pwa-install-banner').classList.remove('hidden');
            }
        },

        // ==========================================
        // UTILIDADES GLOBALES
        // ==========================================
        entrarPantallaCompleta: async () => {
            const elem = document.documentElement;
            try { if (elem.requestFullscreen) await elem.requestFullscreen(); else if (elem.webkitRequestFullscreen) await elem.webkitRequestFullscreen(); } catch (e) { }
            if (screen.orientation && screen.orientation.lock) {
                try { await screen.orientation.lock('landscape'); } catch (e) { }
            }
        },
        salirPantallaCompleta: async () => {
            try {
                if (document.fullscreenElement) await document.exitFullscreen();
                if (screen.orientation && screen.orientation.unlock) screen.orientation.unlock();
            } catch (e) { }
        },
        solicitarWakeLock: async () => {
            if ('wakeLock' in navigator) { try { App.wakeLock = await navigator.wakeLock.request('screen'); } catch (err) { } }
        },
        liberarWakeLock: async () => {
            if (App.wakeLock) { try { await App.wakeLock.release(); App.wakeLock = null; } catch (err) { } }
        },

        // ==========================================
        // ALARMA INERCIAL
        // ==========================================
        AntiToque: {
            armado: false, estado: 'IDLE', baseline: null, lastDelta: 0, lastSpeak: 0, timer15s: null, audioCtx: null, osc: null, intervalBeep: null,
            initSilencioso: function () {
                if (!this.audioCtx) this.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
                this.audioCtx.resume().catch(e => e);
                window.speechSynthesis.speak(new SpeechSynthesisUtterance(''));
                window.addEventListener('deviceorientation', (e) => this.onSensor(e));
            },
            toggle: function () { if (this.armado) this.desarmar(); else this.armar(); return this.armado; },
            armar: function () { this.armado = true; this.estado = 'ARMED'; this.baseline = null; this.detenerTodo(); },
            desarmar: function () { this.armado = false; this.estado = 'IDLE'; this.detenerTodo(); },
            onSensor: function (e) {
                if (!this.armado || e.alpha === null) return;
                if (!this.baseline) { this.baseline = { a: e.alpha, b: e.beta, g: e.gamma }; return; }

                const diffAngle = (a1, a2) => { let d = a1 - a2; while (d < -180) d += 360; while (d > 180) d -= 360; return Math.abs(d); };
                let delta = diffAngle(this.baseline.a, e.alpha) + diffAngle(this.baseline.b, e.beta) + diffAngle(this.baseline.g, e.gamma);

                if (delta > 20) {
                    if (this.estado === 'ARMED') {
                        this.estado = 'WARNING'; this.lastDelta = delta; this.hablar("Ponme donde estaba, anda capullo"); this.lastSpeak = Date.now();
                        this.timer15s = setTimeout(() => { this.estado = 'ALARM'; this.iniciarPito(); }, 15000);
                    } else if (this.estado === 'WARNING') {
                        if (delta > this.lastDelta + 15 && Date.now() - this.lastSpeak > 2000) {
                            this.hablar("así no"); this.lastDelta = delta; this.lastSpeak = Date.now();
                        } else if (Date.now() - this.lastSpeak > 4000) {
                            this.hablar("Ponme donde estaba, anda capullo"); this.lastSpeak = Date.now();
                        }
                    }
                } else if (delta < 10 && (this.estado === 'WARNING' || this.estado === 'ALARM')) {
                    this.estado = 'ARMED'; this.detenerTodo();
                }
            },
            hablar: function (texto) {
                window.speechSynthesis.cancel();
                let u = new SpeechSynthesisUtterance(texto); u.lang = 'es-ES'; u.rate = 1.3; u.pitch = 0.8;
                window.speechSynthesis.speak(u);
            },
            iniciarPito: function () {
                if (this.osc) return; window.speechSynthesis.cancel();
                if (!this.audioCtx) this.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
                this.osc = this.audioCtx.createOscillator(); this.osc.type = 'sawtooth';
                let gain = this.audioCtx.createGain(); gain.gain.value = 1;
                this.osc.connect(gain); gain.connect(this.audioCtx.destination); this.osc.start();
                let alt = false;
                this.intervalBeep = setInterval(() => { this.osc.frequency.setValueAtTime(alt ? 800 : 1600, this.audioCtx.currentTime); alt = !alt; }, 250);
            },
            detenerTodo: function () {
                clearTimeout(this.timer15s); window.speechSynthesis.cancel();
                if (this.osc) { try { this.osc.stop(); this.osc.disconnect(); } catch (e) { } this.osc = null; }
                if (this.intervalBeep) clearInterval(this.intervalBeep);
            }
        },

        ocultarTodo: () => {
            ['inicio-view', 'config-camara-view', 'emision-activa-view', 'lista-camaras-view', 'reproductor-view', 'modal-password'].forEach(id => document.getElementById(id).classList.add('hidden'));
            document.body.classList.remove('modo-espia');
        },
        volverInicio: () => { App.ocultarTodo(); document.getElementById('inicio-view').classList.remove('hidden'); },
        mostrarConfiguracion: () => { App.ocultarTodo(); document.getElementById('config-camara-view').classList.remove('hidden'); },

        // ==========================================
        // BROADCASTER (CÁMARA FÍSICA)
        // ==========================================
        iniciarEmision: async () => {
            const nombre = document.getElementById('nombre-camara').value.trim() || "Cámara";
            App.miPassword = document.getElementById('pass-camara').value;
            if (!App.miPassword) return alert("Contraseña obligatoria.");

            try {
                await App.entrarPantallaCompleta();
                await App.solicitarWakeLock();
                App.AntiToque.initSilencioso();

                App.ocultarTodo(); document.getElementById('emision-activa-view').classList.remove('hidden');
                App.lenteActiva = 'environment';

                App.stream = await navigator.mediaDevices.getUserMedia({
                    video: { facingMode: { ideal: App.lenteActiva }, width: { ideal: 1920 }, height: { ideal: 1080 }, frameRate: { ideal: 30 } },
                    audio: { echoCancellation: true, noiseSuppression: true }
                });

                const videoEl = document.getElementById('video-fuente');
                videoEl.srcObject = App.stream;
                await videoEl.play();

                UI.red('wait', 'Creando Nodo...');
                App.peer = new Peer();

                App.peer.on('open', async (peerId) => {
                    UI.red('ok', 'Nodo Listo');
                    if (!App.camaraId) App.camaraId = 'cam_' + Date.now();
                    const camRef = ref(db, 'cameras/' + App.camaraId);
                    await set(camRef, { id: App.camaraId, nombre: nombre, peerId: peerId, protegida: true });
                    onDisconnect(camRef).remove();

                    document.body.classList.add('modo-espia');
                    App.grabandoDVR = true;
                    App.aplicarMotorDVR(1);
                });

                // RECONEXIÓN AUTOMÁTICA PEERJS
                App.peer.on('disconnected', () => {
                    if (App.grabandoDVR && !App.peer.destroyed) {
                        App.peer.reconnect();
                    }
                });

                // RECONEXIÓN AUTOMÁTICA FIREBASE (Si se cae el WebSocket)
                onValue(ref(db, '.info/connected'), (snap) => {
                    if (snap.val() === true && App.grabandoDVR && App.camaraId && App.peer && App.peer.id) {
                        const camRef = ref(db, 'cameras/' + App.camaraId);
                        set(camRef, { id: App.camaraId, nombre: nombre, peerId: App.peer.id, protegida: true });
                        onDisconnect(camRef).remove();
                    }
                });

                App.peer.on('connection', (conn) => {
                    if (conn.metadata?.password !== App.miPassword) return setTimeout(() => conn.close(), 500);

                    App.dataChannels.push(conn);
                    App.actualizarStatsCámara();

                    if (App.AntiToque.armado) setTimeout(() => { if (conn.open) conn.send({ type: 'antitoque_status', armado: true }); }, 1000);

                    conn.on('data', (data) => {
                        if (data.type === 'req_frame') {
                            const idx = Math.max(0, Math.min(data.index, App.frameBuffer.length - 1));
                            if (App.frameBuffer[idx]) conn.send({ type: 'dvr_playback_data', frame: App.frameBuffer[idx].f });
                        }
                        else if (data.type === 'req_playback') {
                            const idx = Math.max(0, Math.min(data.index, App.frameBuffer.length - 1));
                            if (App.frameBuffer[idx]) {
                                conn.send({ type: 'dvr_playback_data', frame: App.frameBuffer[idx].f, audio: App.frameBuffer[idx].a });
                            }
                        }
                        else if (data.type === 'set_dvr_mode') App.aplicarMotorDVR(parseInt(data.minutos));
                        else if (data.type === 'switch_camera') App.ejecutarCambioLenteLocal();
                        else if (data.type === 'toggle_antitoque') {
                            const estaArmado = App.AntiToque.toggle();
                            App.dataChannels.forEach(c => { if (c.open) c.send({ type: 'antitoque_status', armado: estaArmado }); });
                        }
                    });
                    conn.on('close', () => { App.dataChannels = App.dataChannels.filter(c => c !== conn); App.actualizarStatsCámara(); });
                });

                App.peer.on('call', (call) => {
                    if (call.metadata?.password !== App.miPassword) return call.close();
                    call.answer(App.stream);
                    App.mediaCallsActivas.push(call);
                    call.on('close', () => { App.mediaCallsActivas = App.mediaCallsActivas.filter(c => c !== call); });
                });

            } catch (error) { alert("Error hardware: " + error.message); App.salirPantallaCompleta(); App.liberarWakeLock(); App.volverInicio(); }
        },

        ejecutarCambioLenteLocal: async () => {
            try {
                App.lenteActiva = App.lenteActiva === 'environment' ? 'user' : 'environment';
                document.getElementById('lbl-lente').innerText = App.lenteActiva === 'environment' ? 'Trasera' : 'Frontal';

                if (App.stream) App.stream.getTracks().forEach(t => t.stop());

                const nuevoStream = await navigator.mediaDevices.getUserMedia({
                    video: { facingMode: { ideal: App.lenteActiva }, width: { ideal: 1920 }, height: { ideal: 1080 } },
                    audio: { echoCancellation: true, noiseSuppression: true }
                });

                const nuevaPistaVideo = nuevoStream.getVideoTracks()[0];
                const nuevaPistaAudio = nuevoStream.getAudioTracks()[0];

                App.mediaCallsActivas.forEach(call => {
                    if (call.peerConnection) {
                        const senders = call.peerConnection.getSenders();
                        const senderVideo = senders.find(s => s.track && s.track.kind === 'video');
                        if (senderVideo && nuevaPistaVideo) senderVideo.replaceTrack(nuevaPistaVideo);
                        const senderAudio = senders.find(s => s.track && s.track.kind === 'audio');
                        if (senderAudio && nuevaPistaAudio) senderAudio.replaceTrack(nuevaPistaAudio);
                    }
                });

                const videoEl = document.getElementById('video-fuente');
                App.stream = nuevoStream;
                videoEl.srcObject = App.stream;
                await videoEl.play();
            } catch (error) { }
        },

        // --- MOTOR HÍBRIDO DVR ---
        aplicarMotorDVR: (minutos) => {
            clearInterval(App.dvrInterval);
            if (App.audioRecorder && App.audioRecorder.state !== 'inactive') App.audioRecorder.stop();

            if (minutos === 10) App.configDVR = { minutos: 10, fps: 2, calidadJpeg: 0.2, maxFrames: 1200 };
            else if (minutos === 5) App.configDVR = { minutos: 5, fps: 3, calidadJpeg: 0.3, maxFrames: 900 };
            else App.configDVR = { minutos: 1, fps: 5, calidadJpeg: 0.5, maxFrames: 300 };

            if (App.frameBuffer.length > App.configDVR.maxFrames) App.frameBuffer = App.frameBuffer.slice(App.frameBuffer.length - App.configDVR.maxFrames);

            const videoEl = document.getElementById('video-fuente');
            const canvas = document.getElementById('canvas-dvr');
            const ctx = canvas.getContext('2d');
            canvas.width = 640;
            canvas.height = 480;

            const msDelay = 1000 / App.configDVR.fps;
            App.currentAudioBase64 = null;

            App.dvrInterval = setInterval(() => {
                if (videoEl.videoWidth === 0) return;

                const ratio = Math.min(canvas.width / videoEl.videoWidth, canvas.height / videoEl.videoHeight);
                const newW = videoEl.videoWidth * ratio;
                const newH = videoEl.videoHeight * ratio;
                const offsetX = (canvas.width - newW) / 2;
                const offsetY = (canvas.height - newH) / 2;

                ctx.fillStyle = 'black';
                ctx.fillRect(0, 0, canvas.width, canvas.height);
                ctx.drawImage(videoEl, offsetX, offsetY, newW, newH);

                let packet = { f: canvas.toDataURL('image/jpeg', App.configDVR.calidadJpeg) };

                if (App.currentAudioBase64) {
                    packet.a = App.currentAudioBase64;
                    App.currentAudioBase64 = null;
                }

                App.frameBuffer.push(packet);
                if (App.frameBuffer.length > App.configDVR.maxFrames) App.frameBuffer.shift();

                if (App.frameBuffer.length % App.configDVR.fps === 0) {
                    App.dataChannels.forEach(conn => {
                        if (conn.open) conn.send({ type: 'sync_timeline', maxFrames: App.frameBuffer.length, fps: App.configDVR.fps, minutosConfigurados: App.configDVR.minutos });
                    });
                }
                App.actualizarStatsCámara();
            }, msDelay);

            App.bucleGrabacionAudio();
        },

        bucleGrabacionAudio: () => {
            if (!App.grabandoDVR || !App.stream) return;
            let audioTrack = App.stream.getAudioTracks()[0];
            if (!audioTrack) return;

            let audioStream = new MediaStream([audioTrack]);
            try { App.audioRecorder = new MediaRecorder(audioStream); } catch (e) { return; }

            let chunksLocales = [];
            App.audioRecorder.ondataavailable = e => { if (e.data.size > 0) chunksLocales.push(e.data); };

            App.audioRecorder.onstop = () => {
                if (chunksLocales.length > 0) {
                    let blobAudio = new Blob(chunksLocales, { type: App.audioRecorder.mimeType || 'audio/webm' });
                    const reader = new FileReader();
                    reader.onloadend = () => { App.currentAudioBase64 = reader.result; };
                    reader.readAsDataURL(blobAudio);
                }
                if (App.grabandoDVR) setTimeout(() => App.bucleGrabacionAudio(), 50);
            };

            App.audioRecorder.start();
            setTimeout(() => {
                if (App.audioRecorder && App.audioRecorder.state === 'recording') App.audioRecorder.stop();
                else if (App.grabandoDVR) App.bucleGrabacionAudio();
            }, 1000);
        },

        actualizarStatsCámara: () => {
            document.getElementById('lbl-visores').innerText = App.dataChannels.length;
            document.getElementById('lbl-buffer').innerText = App.frameBuffer.length;
        },

        detenerEmision: async () => {
            App.grabandoDVR = false;
            clearInterval(App.dvrInterval);
            if (App.audioRecorder && App.audioRecorder.state !== 'inactive') App.audioRecorder.stop();
            App.AntiToque.desarmar();
            if (App.peer) App.peer.destroy();
            if (App.stream) App.stream.getTracks().forEach(t => t.stop());
            await App.salirPantallaCompleta();
            await App.liberarWakeLock();
            if (App.camaraId) remove(ref(db, 'cameras/' + App.camaraId));
            App.volverInicio();
        },

        // ==========================================
        // VISOR (REPRODUCTOR REMOTO)
        // ==========================================
        iniciarModoVisor: () => {
            App.ocultarTodo(); document.getElementById('lista-camaras-view').classList.remove('hidden');
            onValue(ref(db, 'cameras'), (snapshot) => {
                const contenedor = document.getElementById('contenedor-lista');
                contenedor.innerHTML = '';
                const data = snapshot.val();
                if (!data) return contenedor.innerHTML = '<p class="text-slate-500 col-span-full text-center py-10">No hay cámaras activas.</p>';

                Object.values(data).forEach(cam => {
                    const div = document.createElement('div');
                    div.className = 'bg-slate-800 p-5 rounded-xl border border-slate-700 hover:border-blue-500 cursor-pointer shadow-lg transition-colors';
                    div.onclick = () => App.abrirModalPassword(cam);
                    div.innerHTML = `
                            <div class="flex items-center justify-between mb-2">
                                <div class="flex items-center gap-3"><span class="w-3 h-3 rounded-full bg-emerald-500 animate-pulse"></span><h3 class="font-semibold text-lg text-white">${cam.nombre}</h3></div>
                                ${cam.protegida ? '<i data-lucide="lock" class="w-5 h-5 text-blue-400"></i>' : ''}
                            </div>
                        `;
                    contenedor.appendChild(div);
                });
                lucide.createIcons();
            });
        },

        abrirModalPassword: (camara) => {
            App.camaraSeleccionada = camara;
            document.getElementById('modal-password').classList.remove('hidden');
            document.getElementById('input-auth-pass').value = '';
            document.getElementById('input-auth-pass').focus();
        },
        cerrarModalPassword: () => { document.getElementById('modal-password').classList.add('hidden'); },

        conectarCamaraSegura: async () => {
            const pass = document.getElementById('input-auth-pass').value;
            if (!pass) return alert("Introduce la contraseña.");

            App.cerrarModalPassword();
            await App.entrarPantallaCompleta();
            const btnWarning = document.getElementById('portrait-warning');
            if (btnWarning) { btnWarning.classList.add('portrait-warning-active'); setTimeout(() => btnWarning.classList.remove('portrait-warning-active'), 5000); }
            await App.solicitarWakeLock();

            App.ocultarTodo();
            document.getElementById('reproductor-view').classList.remove('hidden');
            document.getElementById('overlay-cargando').classList.remove('hidden');
            document.getElementById('texto-carga').innerText = 'Conectando Stream...';

            App.videoRemoto = document.getElementById('video-remoto');
            App.imagenDvr = document.getElementById('dvr-imagen');
            App.videoRemoto.classList.add('hidden'); App.imagenDvr.classList.add('hidden');

            App.videoRemoto.muted = true;
            document.getElementById('icon-audio').setAttribute('data-lucide', 'volume-x');
            document.getElementById('icon-audio').classList.replace('text-emerald-400', 'text-red-400');
            document.getElementById('texto-audio').innerText = "Activar Sonido";

            const btnAnti = document.getElementById('btn-antitoque');
            btnAnti.classList.replace('bg-red-600', 'bg-slate-700'); btnAnti.classList.replace('border-red-400', 'border-slate-600');
            lucide.createIcons();

            App.esLive = true;
            document.getElementById('brillo-slider').value = 1; App.actualizarFiltros();

            App.peer = new Peer();
            App.peer.on('open', () => {
                App.visorDataConn = App.peer.connect(App.camaraSeleccionada.peerId, { metadata: { password: pass } });

                App.visorDataConn.on('open', () => {
                    UI.red('ok', 'Conectado');
                    App.cambiarModoDVRVisor(document.getElementById('selector-dvr').value);

                    let dummy;
                    try {
                        const cv = document.createElement('canvas'); cv.width = 1; cv.height = 1; dummy = cv.captureStream(0);
                        const actx = new (window.AudioContext || window.webkitAudioContext)();
                        dummy.addTrack(actx.createMediaStreamDestination().stream.getAudioTracks()[0]);
                    } catch (e) { }

                    App.visorCall = App.peer.call(App.camaraSeleccionada.peerId, dummy, { metadata: { password: pass } });

                    App.visorCall.on('stream', async (remoteStream) => {
                        document.getElementById('overlay-cargando').classList.add('hidden');
                        App.videoRemoto.srcObject = remoteStream;
                        App.videoRemoto.classList.remove('hidden');
                        await App.videoRemoto.play().catch(e => e);
                        App.actualizarUIVisor(true);
                    });
                });

                App.visorDataConn.on('data', (data) => {
                    if (data.type === 'sync_timeline') {
                        App.bufferSizeRemoto = data.maxFrames;
                        App.fpsRemoto = data.fps;

                        const tl = document.getElementById('cam-timeline');
                        tl.max = Math.max(0, data.maxFrames - 1);
                        document.getElementById('tiempo-dvr-max').innerText = `-${data.minutosConfigurados}m máx`;

                        if (App.esLive) {
                            tl.value = tl.max;
                            document.getElementById('tiempo-dvr').innerText = 'EN DIRECTO';
                        }
                    }
                    else if (data.type === 'dvr_playback_data') {
                        document.getElementById('overlay-cargando').classList.add('hidden');
                        App.imagenDvr.src = data.frame;
                        if (data.audio && !App.videoRemoto.muted) {
                            App.audioPlayer.src = data.audio;
                            App.audioPlayer.play().catch(e => e);
                        }
                    }
                    else if (data.type === 'antitoque_status') {
                        const btnAnti = document.getElementById('btn-antitoque');
                        if (data.armado) { btnAnti.classList.replace('bg-slate-700', 'bg-red-600'); btnAnti.classList.replace('border-slate-600', 'border-red-400'); }
                        else { btnAnti.classList.replace('bg-red-600', 'bg-slate-700'); btnAnti.classList.replace('border-red-400', 'border-slate-600'); }
                    }
                });

                App.visorDataConn.on('close', () => { App.desconectarVisor(); alert("Conexión perdida."); });
            });
        },

        toggleAudioVisor: () => {
            if (!App.videoRemoto) return;
            const targetMute = !App.videoRemoto.muted;
            App.videoRemoto.muted = targetMute;

            const btn = document.getElementById('btn-audio-toggle');
            if (targetMute) {
                btn.innerHTML = `<i data-lucide="volume-x" class="w-4 h-4 text-red-400"></i> <span id="texto-audio">Activar Sonido</span>`;
                App.audioPlayer.pause();
            } else {
                App.videoRemoto.volume = 1.0; App.videoRemoto.play().catch(e => { });
                btn.innerHTML = `<i data-lucide="volume-2" class="w-4 h-4 text-emerald-400"></i> <span id="texto-audio">Sonido ON</span>`;
            }
            lucide.createIcons();
        },

        ordenarCambioLente: () => { if (App.visorDataConn && App.visorDataConn.open) { UI.red('wait', 'Girando cámara...'); App.visorDataConn.send({ type: 'switch_camera' }); } },
        ordenarAntiToque: () => { if (App.visorDataConn && App.visorDataConn.open) App.visorDataConn.send({ type: 'toggle_antitoque' }); },
        cambiarModoDVRVisor: (minutosStr) => { if (App.visorDataConn && App.visorDataConn.open) { App.visorDataConn.send({ type: 'set_dvr_mode', minutos: minutosStr }); App.volverAlLive(); } },

        desconectarVisor: async () => {
            await App.salirPantallaCompleta(); await App.liberarWakeLock();
            clearInterval(App.dvrPlaybackInterval);
            App.audioPlayer.pause();
            if (App.visorCall) App.visorCall.close();
            if (App.visorDataConn) App.visorDataConn.close();
            if (App.peer) App.peer.destroy();
            if (App.videoRemoto) { App.videoRemoto.pause(); App.videoRemoto.srcObject = null; }
            if (App.imagenDvr) App.imagenDvr.src = '';
            document.getElementById('reproductor-view').classList.add('hidden');
            App.iniciarModoVisor();
        },

        actualizarFiltros: () => {
            const val = document.getElementById('brillo-slider').value;
            App.filtroBrillo = parseFloat(val);
            if (App.videoRemoto) App.videoRemoto.style.filter = `brightness(${App.filtroBrillo}) contrast(${1 + (App.filtroBrillo * 0.1)})`;
            if (App.imagenDvr) App.imagenDvr.style.filter = `brightness(${App.filtroBrillo}) contrast(${1.2 + (App.filtroBrillo * 0.1)}) saturate(0.5)`;
        },

        actualizarTextoTiempoTimeline: (indice) => {
            const maxIndex = Math.max(0, App.bufferSizeRemoto - 1);
            const framesAtras = Math.max(0, maxIndex - indice);

            if (framesAtras === 0) {
                document.getElementById('tiempo-dvr').innerText = 'EN DIRECTO';
                return;
            }

            const segundosAtras = Math.floor(framesAtras / App.fpsRemoto);
            let tiempoTexto = `-${segundosAtras}s`;
            if (segundosAtras >= 60) {
                const min = Math.floor(segundosAtras / 60);
                const sec = segundosAtras % 60;
                tiempoTexto = `-${min}m ${sec}s`;
            }
            document.getElementById('tiempo-dvr').innerText = tiempoTexto;
        },

        alMoverTimelineArrastre: (valor) => {
            clearInterval(App.dvrPlaybackInterval);
            const indice = parseInt(valor);
            App.actualizarTextoTiempoTimeline(indice);

            if (indice < App.bufferSizeRemoto - 2) {
                App.esLive = false;
                App.videoRemoto.classList.add('hidden');
                App.imagenDvr.classList.remove('hidden');
                App.actualizarUIVisor(false);

                if (App.videoRemoto && !App.videoRemoto.muted) App.videoRemoto.muted = true;

                if (App.visorDataConn && App.visorDataConn.open) {
                    App.visorDataConn.send({ type: 'req_frame', index: indice });
                }
            }
        },

        alSoltarTimeline: (valor) => {
            const indice = parseInt(valor);

            if (indice >= App.bufferSizeRemoto - 2) {
                App.volverAlLive();
            } else {
                App.reproduciendoDvrIndex = indice;
                App.iniciarReproduccionDvr();
            }
        },

        iniciarReproduccionDvr: () => {
            clearInterval(App.dvrPlaybackInterval);
            App.dvrPlaybackInterval = setInterval(() => {
                if (App.esLive || !App.visorDataConn || !App.visorDataConn.open) {
                    clearInterval(App.dvrPlaybackInterval);
                    return;
                }
                if (App.reproduciendoDvrIndex >= App.bufferSizeRemoto - 2) {
                    App.volverAlLive();
                    return;
                }

                App.visorDataConn.send({ type: 'req_playback', index: App.reproduciendoDvrIndex });
                document.getElementById('cam-timeline').value = App.reproduciendoDvrIndex;
                App.actualizarTextoTiempoTimeline(App.reproduciendoDvrIndex);

                App.reproduciendoDvrIndex++;
            }, 1000 / App.fpsRemoto);
        },

        volverAlLive: () => {
            clearInterval(App.dvrPlaybackInterval);
            App.esLive = true;
            App.audioPlayer.pause();
            App.imagenDvr.classList.add('hidden');
            App.videoRemoto.classList.remove('hidden');
            App.actualizarUIVisor(true);
            const tl = document.getElementById('cam-timeline');
            tl.value = tl.max;
            document.getElementById('tiempo-dvr').innerText = 'EN DIRECTO';

            const txtAudio = document.getElementById('texto-audio').innerText.trim();
            if (txtAudio === "Sonido ON" && App.videoRemoto) App.videoRemoto.muted = false;
        },

        actualizarUIVisor: (live) => {
            const indicador = document.getElementById('estado-reproduccion');
            const dot = document.getElementById('estado-dot');
            const texto = document.getElementById('estado-texto');
            const btnLive = document.getElementById('btn-live-control');

            if (live) {
                indicador.className = "px-4 py-1.5 rounded-full text-xs font-bold tracking-wide bg-red-500/20 text-red-400 border border-red-500/30 flex items-center gap-2 backdrop-blur-sm shadow-lg";
                dot.className = "w-2.5 h-2.5 rounded-full bg-red-500 animate-pulse";
                texto.innerText = "LIVE HD (A/V)";
                btnLive.classList.add('hidden');
                document.getElementById('tiempo-dvr').classList.replace('text-yellow-400', 'text-blue-400');
            } else {
                indicador.className = "px-4 py-1.5 rounded-full text-xs font-bold tracking-wide bg-yellow-500/20 text-yellow-400 border border-yellow-500/30 flex items-center gap-2 backdrop-blur-sm shadow-lg";
                dot.className = "w-2.5 h-2.5 rounded-full bg-yellow-500";
                texto.innerText = "DVR MEMORIA";
                btnLive.classList.remove('hidden');
                document.getElementById('tiempo-dvr').classList.replace('text-blue-400', 'text-yellow-400');
            }
        }
    };

    const timelineEl = document.getElementById('cam-timeline');
    timelineEl.addEventListener('input', (e) => App.alMoverTimelineArrastre(e.target.value));
    timelineEl.addEventListener('change', (e) => App.alSoltarTimeline(e.target.value));
    timelineEl.addEventListener('touchmove', (e) => e.stopPropagation(), { passive: false });

    window.addEventListener('keydown', (e) => {
        if (document.getElementById('reproductor-view').classList.contains('hidden')) return;
        const salto = e.shiftKey ? Math.max(1, App.fpsRemoto) * 2 : 1;
        let idx = parseInt(timelineEl.value);

        if (e.key === 'ArrowLeft') {
            e.preventDefault(); timelineEl.value = Math.max(0, idx - salto);
            App.alMoverTimelineArrastre(timelineEl.value); App.alSoltarTimeline(timelineEl.value);
        }
        else if (e.key === 'ArrowRight') {
            e.preventDefault(); timelineEl.value = Math.min(timelineEl.max, idx + salto);
            App.alMoverTimelineArrastre(timelineEl.value); App.alSoltarTimeline(timelineEl.value);
        }
    });

    // Evento Global PWA Install (Con Detección Inicial de Estado)
    window.addEventListener('beforeinstallprompt', (e) => {
        e.preventDefault();
        App.deferredPrompt = e;
        document.getElementById('pwa-install-banner').classList.remove('hidden');
    });

    // Ejecutar comprobación al cargar la app
    window.addEventListener('DOMContentLoaded', () => {
        App.chequearEstadoInstalacion();
    });

    document.addEventListener('visibilitychange', async () => {
        if (document.visibilityState === 'visible' && (App.camaraId || App.visorCall)) await App.solicitarWakeLock();
    });

    lucide.createIcons();
}
// Init Core App Flow
initCore().catch(err => {
    console.error("No se pudo iniciar Firebase. Revisa tu conexión:", err);
});

if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js').catch(() => { });
}
