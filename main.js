import { HandLandmarker, FaceLandmarker, FilesetResolver } from "@mediapipe/tasks-vision";

// 游戏配置
const BUGS_DATA = [
    { id: 'fly', name: '机伶小蝇', icon: '🪰', speed: 2, points: 10 },
    { id: 'beetle', name: '硬壳甲虫', icon: '🪲', speed: 1.2, points: 20 },
    { id: 'butterfly', name: '幻梦蝴蝶', icon: '🦋', speed: 1.5, points: 30 }
];

class PerfectHitGame {
    constructor() {
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
        this.resize();
        window.addEventListener('resize', () => this.resize());

        try {
            const vision = await FilesetResolver.forVisionTasks(
                "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.9/wasm"
            );

            // 初始化手势识别
            this.handLandmarker = await HandLandmarker.createFromOptions(vision, {
                baseOptions: {
                    modelAssetPath: `/models/hand_landmarker.task`,
                    delegate: "GPU"
                },
                runningMode: "VIDEO",
                numHands: 2
            });

            // 初始化面部识别 (用于视差效果)
            this.faceLandmarker = await FaceLandmarker.createFromOptions(vision, {
                baseOptions: {
                    modelAssetPath: `/models/face_landmarker.task`,
                    delegate: "GPU"
                },
                runningMode: "VIDEO"
            });

            await this.setupCamera();
            this.loader.classList.add('hidden');
            this.spawnBug();
            this.loop();
        } catch (error) {
            console.error("Initialization Failed:", error);
            alert("无法加载 AI 模型，请检查网络或摄像头权限。");
        }
    }

    async setupCamera() {
        const stream = await navigator.mediaDevices.getUserMedia({ video: true });
        this.video.srcObject = stream;
        return new Promise((resolve) => {
            this.video.onloadedmetadata = () => resolve();
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

        // 每隔 3-5 秒尝试生成一只新的
        setTimeout(() => this.spawnBug(), 3000 + Math.random() * 2000);
    }

    updateBugs() {
        this.bugs.forEach(bug => {
            // 随机游走
            bug.angle += (bug.targetAngle - bug.angle) * 0.05;
            if (Math.random() > 0.98) bug.targetAngle = Math.random() * Math.PI * 2;

            bug.x += Math.cos(bug.angle) * bug.speed;
            bug.y += Math.sin(bug.angle) * bug.speed;

            // 边缘检测
            if (bug.x < 0 || bug.x > this.canvas.width) bug.angle = Math.PI - bug.angle;
            if (bug.y < 0 || bug.y > this.canvas.height) bug.angle = -bug.angle;

            // 微微晃动
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

        // 手掌中心点 (Landmark 0 是腕部, 我们取 Landmark 9 中指根部作为中心)
        const p1 = hands[0].landmarks[9];
        const p2 = hands[1].landmarks[9];

        const dist = Math.sqrt(
            Math.pow(p1.x - p2.x, 2) +
            Math.pow(p1.y - p2.y, 2)
        );

        // 阈值 (归一化坐标，0.15 约为双手靠近)
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
            const dist = Math.sqrt(
                Math.pow(bug.x - (this.canvas.width - clapPos.x), 2) + // 注意摄像头是镜像的
                Math.pow(bug.y - clapPos.y, 2)
            );

            if (dist < 80) { // 判定范围
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

        // 简单的打击特效可以以后加
        console.log(`Caught ${bug.name}!`);
        this.updateEncyclopedia();
    }

    updateEncyclopedia() {
        const list = document.getElementById('bug-list');
        list.innerHTML = BUGS_DATA.map(bug => `
            <div class="bug-item ${this.unlockedBugs.has(bug.id) ? 'unlocked' : ''}">
                <div class="bug-icon">${bug.icon}</div>
                <div class="bug-name">${this.unlockedBugs.has(bug.id) ? bug.name : '???'}</div>
            </div>
        `).join('');
    }

    updateParallax(faceLandmarks) {
        if (!faceLandmarks || faceLandmarks.length === 0) return;

        // 取鼻尖 (Landmark 1)
        const nose = faceLandmarks[0][1];
        const tx = (nose.x - 0.5) * 30; // 映射到 -15deg ~ 15deg
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
            // 简单旋转
            this.ctx.rotate(bug.angle + Math.PI / 2);
            this.ctx.fillText(bug.icon, 0, 0);
            this.ctx.restore();
        });

        // 绘制双手引导提示 (Debug/Visual Feedback)
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

        // AI 追踪
        if (this.video.readyState >= 2) {
            const handResults = this.handLandmarker.detectForVideo(this.video, now);
            this.hands = handResults.landmarks.map((landmarks, i) => ({
                landmarks,
                handedness: handResults.handedness[i]
            }));

            const faceResults = this.faceLandmarker.detectForVideo(this.video, now);
            this.updateParallax(faceResults.faceLandmarks);

            const clapPos = this.detectClap(this.hands);
            if (clapPos) this.checkCollision(clapPos);
        }

        this.updateBugs();
        this.draw();
        requestAnimationFrame(() => this.loop());
    }
}

// 启动游戏
const game = new PerfectHitGame();

// UI 控制
document.getElementById('encyclopedia-btn').onclick = () => {
    document.getElementById('modal').classList.remove('hidden');
    game.updateEncyclopedia();
};

document.getElementById('close-modal').onclick = () => {
    document.getElementById('modal').classList.add('hidden');
};
