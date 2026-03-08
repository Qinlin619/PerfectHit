// 使用完整 CDN 路径，确保在无打包环境（http-server）下也能运行
import { HandLandmarker, FaceLandmarker, FilesetResolver } from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.9/vision_bundle.mjs";

// 游戏配置
const BUGS_DATA = [
    { id: 'fly', name: '机伶小蝇', icon: '🪰', speed: 2, points: 10 },
    { id: 'beetle', name: '硬壳甲虫', icon: '🪲', speed: 1.2, points: 20 },
    { id: 'butterfly', name: '幻梦蝴蝶', icon: '🦋', speed: 1.5, points: 30 }
];

class PerfectHitGame {
    constructor() {
        console.log("Game Constructor Started");
        this.canvas = document.getElementById('game-canvas');
        this.ctx = this.canvas.getContext('2d');
        this.video = document.getElementById('webcam');
        this.scoreElement = document.getElementById('score');
        this.countElement = document.getElementById('count');
        this.loader = document.getElementById('loader');
        this.tutorialOverlay = document.getElementById('tutorial-overlay');
        this.notificationContainer = document.getElementById('notification-container');

        // 音频系统
        this.audioCtx = new (window.AudioContext || window.webkitAudioContext)();

        this.score = 0;
        this.catchCount = 0;
        this.unlockedBugs = new Set();
        this.bugs = [];
        this.hands = [];
        this.prevDist = 1.0;
        this.isClapping = false;
        this.isPaused = true; // 初始暂停，等待教程结束
        this.lastClapTime = 0;

        this.init();
    }

    async init() {
        console.log("Initialization Started...");
        this.resize();
        window.addEventListener('resize', () => this.resize());

        try {
            console.log("Loading FilesetResolver...");
            const vision = await FilesetResolver.forVisionTasks(
                "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.9/wasm"
            );

            console.log("Initializing HandLandmarker with local model...");
            this.handLandmarker = await HandLandmarker.createFromOptions(vision, {
                baseOptions: {
                    modelAssetPath: `./models/hand_landmarker.task`,
                    delegate: "GPU"
                },
                runningMode: "VIDEO",
                numHands: 2
            });

            console.log("Initializing FaceLandmarker with local model...");
            this.faceLandmarker = await FaceLandmarker.createFromOptions(vision, {
                baseOptions: {
                    modelAssetPath: `./models/face_landmarker.task`,
                    delegate: "GPU"
                },
                runningMode: "VIDEO"
            });

            console.log("Setting up camera...");
            await this.setupCamera();
            console.log("Camera ready!");

            this.loader.style.opacity = '0';
            setTimeout(() => {
                this.loader.classList.add('hidden');
                // 显示教程
                this.tutorialOverlay.classList.remove('hidden');
                this.setupTutorial();
            }, 800);

            this.loop();
        } catch (error) {
            console.error("Initialization Failed:", error);
            const loadingText = document.querySelector('.loading-text');
            if (loadingText) {
                loadingText.innerText = "加载失败: " + error.message;
                loadingText.style.color = "red";
            }
        }
    }

    setupTutorial() {
        const startBtn = document.getElementById('start-tutorial-btn');
        startBtn.onclick = () => {
            this.tutorialOverlay.style.opacity = '0';
            setTimeout(() => {
                this.tutorialOverlay.classList.add('hidden');
                this.isPaused = false;
                this.spawnBug();
            }, 500);
        };
    }

    async setupCamera() {
        const constraints = {
            video: {
                width: { ideal: 1280 },
                height: { ideal: 720 }
            }
        };
        const stream = await navigator.mediaDevices.getUserMedia(constraints);
        this.video.srcObject = stream;
        return new Promise((resolve) => {
            this.video.onloadedmetadata = () => {
                this.video.play();
                resolve();
            };
        });
    }

    resize() {
        this.canvas.width = window.innerWidth;
        this.canvas.height = window.innerHeight;
    }

    spawnBug() {
        if (this.isPaused) return;
        const type = BUGS_DATA[Math.floor(Math.random() * BUGS_DATA.length)];
        this.bugs.push({
            ...type,
            x: Math.random() * (this.canvas.width - 100) + 50,
            y: Math.random() * (this.canvas.height - 100) + 50,
            angle: Math.random() * Math.PI * 2,
            targetAngle: Math.random() * Math.PI * 2,
            size: 60,
            phase: Math.random() * 10
        });

        setTimeout(() => this.spawnBug(), 3000 + Math.random() * 2000);
    }

    updateBugs() {
        if (this.isPaused) return;
        this.bugs.forEach(bug => {
            bug.angle += (bug.targetAngle - bug.angle) * 0.05;
            if (Math.random() > 0.98) bug.targetAngle = Math.random() * Math.PI * 2;

            bug.x += Math.cos(bug.angle) * bug.speed;
            bug.y += Math.sin(bug.angle) * bug.speed;

            if (bug.x < 50 || bug.x > this.canvas.width - 50) bug.angle = Math.PI - bug.angle;
            if (bug.y < 50 || bug.y > this.canvas.height - 50) bug.angle = -bug.angle;

            bug.phase += 0.1;
            bug.displayX = bug.x + Math.sin(bug.phase) * 5;
            bug.displayY = bug.y + Math.cos(bug.phase) * 5;
        });
    }

    detectClap(hands) {
        if (hands.length < 2) {
            this.isClapping = false;
            return false;
        }

        const h1 = hands[0].landmarks;
        const h2 = hands[1].landmarks;

        // 计算手部在屏幕上的大致大小 (腕部到中指根部的距离)
        const getHandSize = (landmarks) => Math.sqrt(
            Math.pow(landmarks[0].x - landmarks[9].x, 2) +
            Math.pow(landmarks[0].y - landmarks[9].y, 2)
        );
        const handSize = (getHandSize(h1) + getHandSize(h2)) / 2;

        // 掌心中心点
        const p1 = h1[9];
        const p2 = h2[9];

        const currentDist = Math.sqrt(
            Math.pow(p1.x - p2.x, 2) +
            Math.pow(p1.y - p2.y, 2)
        );

        // 如果两手距离小于 1.8 倍的手掌大小，即认为是在拍手动作范围内
        const clapThreshold = handSize * 1.8;
        const velocity = this.prevDist - currentDist;
        this.prevDist = currentDist;

        const now = Date.now();
        // 降低了对 velocity 的严苛要求，增加了对距离的动态感知
        if (currentDist < clapThreshold && (velocity > 0.005 || currentDist < handSize * 0.8) && now - this.lastClapTime > 300) {
            this.isClapping = true;
            this.lastClapTime = now;
            this.playClapSound(); // 触发声音
            return {
                x: (p1.x + p2.x) / 2 * this.canvas.width,
                y: (p1.y + p2.y) / 2 * this.canvas.height
            };
        }

        if (currentDist > clapThreshold * 1.5) {
            this.isClapping = false;
        }

        return false;
    }

    playClapSound() {
        if (this.audioCtx.state === 'suspended') this.audioCtx.resume();
        const oscillator = this.audioCtx.createOscillator();
        const gain = this.audioCtx.createGain();

        oscillator.type = 'square';
        oscillator.frequency.setValueAtTime(150, this.audioCtx.currentTime);
        oscillator.frequency.exponentialRampToValueAtTime(1, this.audioCtx.currentTime + 0.1);

        gain.gain.setValueAtTime(0.1, this.audioCtx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.01, this.audioCtx.currentTime + 0.1);

        oscillator.connect(gain);
        gain.connect(this.audioCtx.destination);

        oscillator.start();
        oscillator.stop(this.audioCtx.currentTime + 0.1);
    }

    checkCollision(clapPos) {
        if (!clapPos) return;

        for (let i = this.bugs.length - 1; i >= 0; i--) {
            const bug = this.bugs[i];
            const bugScreenX = bug.x;
            const bugScreenY = bug.y;
            // 摄像头镜像，我们需要镜像 clapPos.x 来对比 bug.x
            const clapScreenX = this.canvas.width - clapPos.x;
            const clapScreenY = clapPos.y;

            const dist = Math.sqrt(
                Math.pow(bugScreenX - clapScreenX, 2) +
                Math.pow(bugScreenY - clapScreenY, 2)
            );

            if (dist < 100) {
                const isPerfect = dist < 30;
                this.catchBug(bug, i, isPerfect, clapScreenX, clapScreenY);
                break;
            }
        }
    }

    catchBug(bug, index, isPerfect, x, y) {
        let points = bug.points;
        if (isPerfect) points *= 2;

        this.score += points;
        this.catchCount++;

        this.scoreElement.innerText = `得分: ${this.score}`;
        this.countElement.innerText = `捕捉数量: ${this.catchCount}`;

        this.unlockedBugs.add(bug.id);
        this.bugs.splice(index, 1);

        this.showNotification(isPerfect ? "PERFECT HIT!" : "击中! +1", isPerfect, x, y);
        this.updateEncyclopedia();
    }

    showNotification(text, isPerfect, x, y) {
        const el = document.createElement('div');
        el.className = `notification ${isPerfect ? 'hit-perfect' : 'hit-normal'}`;
        el.style.left = `${x}px`;
        el.style.top = `${y}px`;
        el.innerText = text;

        this.notificationContainer.appendChild(el);
        setTimeout(() => el.remove(), 1000);
    }

    updateEncyclopedia() {
        const list = document.getElementById('bug-list');
        if (!list) return;
        list.innerHTML = BUGS_DATA.map(bug => `
            <div class="bug-item ${this.unlockedBugs.has(bug.id) ? 'unlocked' : ''}">
                <div class="bug-icon">${bug.icon}</div>
                <div class="bug-name">${this.unlockedBugs.has(bug.id) ? bug.name : '???'}</div>
            </div>
        `).join('');
    }

    updateParallax(faceLandmarks) {
        if (!faceLandmarks || faceLandmarks.length === 0) return;

        const nose = faceLandmarks[0][1];
        const tx = (nose.x - 0.5) * 30;
        const ty = (nose.y - 0.5) * 20;

        document.documentElement.style.setProperty('--tilt-x', `${-tx}deg`);
        document.documentElement.style.setProperty('--tilt-y', `${ty}deg`);
    }

    draw() {
        this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

        // 绘制虫子
        this.ctx.font = '50px serif';
        this.ctx.textAlign = 'center';
        this.ctx.textBaseline = 'middle';

        this.bugs.forEach(bug => {
            this.ctx.save();
            this.ctx.translate(bug.displayX, bug.displayY);
            this.ctx.rotate(bug.angle + Math.PI / 2);
            this.ctx.fillText(bug.icon, 0, 0);
            this.ctx.restore();
        });

        // 绘制手势引导 (让用户看清手在哪)
        if (this.hands && this.hands.length > 0) {
            this.ctx.save();

            // 如果有两只手，画一条连线
            if (this.hands.length === 2) {
                const p1 = { x: (1 - this.hands[0].landmarks[9].x) * this.canvas.width, y: this.hands[0].landmarks[9].y * this.canvas.height };
                const p2 = { x: (1 - this.hands[1].landmarks[9].x) * this.canvas.width, y: this.hands[1].landmarks[9].y * this.canvas.height };

                this.ctx.beginPath();
                this.ctx.moveTo(p1.x, p1.y);
                this.ctx.lineTo(p2.x, p2.y);
                this.ctx.strokeStyle = this.isClapping ? 'rgba(255, 71, 87, 0.8)' : 'rgba(255, 255, 255, 0.2)';
                this.ctx.setLineDash([5, 5]);
                this.ctx.lineWidth = 2;
                this.ctx.stroke();
            }

            this.hands.forEach((hand, index) => {
                const center = hand.landmarks[9];
                const x = (1 - center.x) * this.canvas.width;
                const y = center.y * this.canvas.height;

                // 判断手部是否侧向 (变扁)
                // 计算大拇指到小拇指的水平距离作为宽度参考
                const thumbBase = hand.landmarks[1];
                const pinkyBase = hand.landmarks[17];
                const handWidth = Math.abs(thumbBase.x - pinkyBase.x);
                const isFlat = handWidth < 0.04;

                this.ctx.save();
                this.ctx.translate(x, y);

                // 绘制光晕
                const gradient = this.ctx.createRadialGradient(0, 0, 0, 0, 0, 60);
                if (this.isClapping) {
                    gradient.addColorStop(0, 'rgba(255, 204, 0, 0.8)');
                    gradient.addColorStop(1, 'rgba(255, 204, 0, 0)');
                } else {
                    gradient.addColorStop(0, 'rgba(255, 255, 255, 0.2)');
                    gradient.addColorStop(1, 'rgba(255, 255, 255, 0)');
                }

                this.ctx.fillStyle = gradient;
                this.ctx.beginPath();
                this.ctx.arc(0, 0, this.isClapping ? 100 : 60, 0, Math.PI * 2);
                this.ctx.fill();

                // 展现不同的手势图标
                this.ctx.font = '40px serif';
                if (this.isClapping) {
                    this.ctx.fillText('💥', 0, 0);
                } else if (isFlat) {
                    // 如果手侧过来了，显示侧向图标
                    this.ctx.scale(0.5, 1);
                    this.ctx.fillText('✋', 0, 0);
                } else {
                    this.ctx.fillText('✋', 0, 0);
                }

                this.ctx.restore();

                // 绘制提示文字
                this.ctx.font = '12px Inter';
                this.ctx.fillStyle = 'rgba(255,255,255,0.5)';
                this.ctx.fillText(hand.handedness[0].categoryName === 'Left' ? '右手' : '左手', x, y + 50);
                // 注意：摄像头镜像后，左手会变成右手，这里文字提示用户镜像感知
            });
            this.ctx.restore();
        }
    }

    async loop() {
        const now = performance.now();

        if (this.video.readyState >= 2) {
            try {
                const faceResults = this.faceLandmarker.detectForVideo(this.video, now);
                this.updateParallax(faceResults.faceLandmarks);

                if (!this.isPaused) {
                    const handResults = this.handLandmarker.detectForVideo(this.video, now);
                    this.hands = handResults.landmarks.map((landmarks, i) => ({
                        landmarks,
                        handedness: handResults.handedness[i]
                    }));

                    const clapPos = this.detectClap(this.hands);
                    if (clapPos) this.checkCollision(clapPos);
                }
            } catch (e) { }
        }

        this.updateBugs();
        this.draw();
        requestAnimationFrame(() => this.loop());
    }
}

// 启动游戏
window.onload = () => {
    const game = new PerfectHitGame();

    document.getElementById('encyclopedia-btn').onclick = () => {
        document.getElementById('modal').classList.remove('hidden');
        game.updateEncyclopedia();
    };

    document.getElementById('close-modal').onclick = () => {
        document.getElementById('modal').classList.add('hidden');
    };
};
