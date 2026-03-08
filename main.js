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
        this.loader = document.getElementById('loader');

        this.score = 0;
        this.unlockedBugs = new Set();
        this.bugs = [];
        this.hands = [];
        this.isClapping = false;

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
            // 初始化手势识别
            this.handLandmarker = await HandLandmarker.createFromOptions(vision, {
                baseOptions: {
                    // 修正路径：现在 models/ 就在根目录
                    modelAssetPath: `./models/hand_landmarker.task`,
                    delegate: "GPU"
                },
                runningMode: "VIDEO",
                numHands: 2
            });

            console.log("Initializing FaceLandmarker with local model...");
            // 初始化面部识别 (用于视差效果)
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
            }, 800);

            this.spawnBug();
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

    async setupCamera() {
        // 请求权限
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

        const p1 = hands[0].landmarks[9];
        const p2 = hands[1].landmarks[9];

        const dist = Math.sqrt(
            Math.pow(p1.x - p2.x, 2) +
            Math.pow(p1.y - p2.y, 2)
        );

        const clapThreshold = 0.12;

        if (dist < clapThreshold && !this.isClapping) {
            this.isClapping = true;
            return {
                x: (p1.x + p2.x) / 2 * this.canvas.width,
                y: (p1.y + p2.y) / 2 * this.canvas.height
            };
        }

        if (dist > clapThreshold + 0.05) {
            this.isClapping = false;
        }

        return false;
    }

    checkCollision(clapPos) {
        if (!clapPos) return;

        for (let i = this.bugs.length - 1; i >= 0; i--) {
            const bug = this.bugs[i];
            // 摄像头镜像处理：1 - x
            const dist = Math.sqrt(
                Math.pow(bug.x - (this.canvas.width - clapPos.x), 2) +
                Math.pow(bug.y - clapPos.y, 2)
            );

            if (dist < 100) {
                this.catchBug(bug, i);
                break;
            }
        }
    }

    catchBug(bug, index) {
        this.score += bug.points;
        this.scoreElement.innerText = `得分: ${this.score}`;
        this.unlockedBugs.add(bug.id);
        this.bugs.splice(index, 1);
        this.updateEncyclopedia();
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

        if (this.hands && this.hands.length > 0) {
            this.ctx.fillStyle = this.isClapping ? 'rgba(255, 71, 87, 0.5)' : 'rgba(255, 255, 255, 0.2)';
            this.hands.forEach(hand => {
                const center = hand.landmarks[9];
                this.ctx.beginPath();
                this.ctx.arc((1 - center.x) * this.canvas.width, center.y * this.canvas.height, 40, 0, Math.PI * 2);
                this.ctx.fill();
            });
        }
    }

    async loop() {
        const now = performance.now();

        if (this.video.readyState >= 2) {
            try {
                const handResults = this.handLandmarker.detectForVideo(this.video, now);
                this.hands = handResults.landmarks.map((landmarks, i) => ({
                    landmarks,
                    handedness: handResults.handedness[i]
                }));

                const faceResults = this.faceLandmarker.detectForVideo(this.video, now);
                this.updateParallax(faceResults.faceLandmarks);

                const clapPos = this.detectClap(this.hands);
                if (clapPos) this.checkCollision(clapPos);
            } catch (e) {
                // 模型检测偶尔报错不中断循环
            }
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
