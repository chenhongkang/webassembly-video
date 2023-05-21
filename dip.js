const kernel = [
    [-1, -1, 1], 
    [-1, 14, -1], 
    [1, -1, -1]
]

const vector = [];
let globalStatus = 'STOP';
let clientX;
let clientY;



let bytes = await (await fetch('./dip.wasm')).arrayBuffer();
let { instance, module } = await WebAssembly.instantiate(bytes);
let { 
  cppConvFilter, 
  cppGetkernelPtr, 
  cppGetDataPtr, 
  memory } = instance.exports;

// 获取 C/C++ 中存有卷积核矩阵和帧像素数据的数组，在 Wasm 线性内存段中的偏移位置；
const dataOffset = cppGetDataPtr();
const kernOffset = cppGetkernelPtr();
// 扁平化卷积核的二维数组到一位数组，以方便数据的填充；
const flatKernel = kernel.reduce((acc, cur) => acc.concat(cur), []);
// 为 Wasm 模块的线性内存段设置两个用于进行数据操作的视图，分别对应卷积核矩阵和帧像素数据；
let Uint8View = new Uint8Array(memory.buffer);
let Int8View = new Int8Array(memory.buffer);
// 填充卷积核矩阵数据；
Int8View.set(flatKernel, kernOffset);
// 封装的 Wasm 滤镜处理函数；
function filterWasm (pixelData, width, height) {
  const arLen = pixelData.length;
  // 填充当前帧画面的像素数据；
  Uint8View.set(pixelData, dataOffset);
  // 调用滤镜处理函数；
  cppConvFilter(width, height, 4);
  // 返回经过处理的数据；
  return Uint8View.subarray(dataOffset, dataOffset + arLen);
}

function listenVideoMode() {
    // 全局状态；
    const STATUS = ['STOP', 'JS', 'WASM'];
    // 监听用户点击事件；
    document.querySelector("button").addEventListener('click', () => {
        globalStatus = STATUS[
            Number(
                document.querySelector("input[name='options']:checked").value
            )
        ];
    });
}

function playWithCanvas() {
    // 定义绘制函数；
    function draw() {
        const currentTimestamp = performance.now();
        fps.innerHTML = calcFPS(currentTimestamp - timestamp);
        timestamp = currentTimestamp;
        context.drawImage(video, 0, 0);
        // 获得 <canvas> 上当前帧对应画面的像素数组；
        const pixels = context.getImageData(0, 0, video.videoWidth, video.videoHeight);
        switch (globalStatus) {
            case "JS": {
                pixels.data.set(filterJS(pixels.data, clientX, clientY));
                break;
            }
            case "WASM": {
                pixels.data.set(filterWasm(pixels.data, clientX, clientY));
                break;
            }
        }
      
        // append image onto the canvas.
        context.putImageData(pixels, 0, 0);      
        requestAnimationFrame(draw);
    }
    
    let timestamp = performance.now();
    let video = document.querySelector('.video');
    let canvas = document.querySelector('.canvas');
    let fps = document.querySelector('.fps-num');

    // 使用 getContext 方法获取 <canvas> 标签对应的一个 CanvasRenderingContext2D 接口；
    let context = canvas.getContext('2d');
    
    // 自动播放 <video> 载入的视频；
    let promise = video.play();
    if (promise !== undefined) {
        promise.catch(error => {
            console.error("The video can not autoplay!")
        });
    }
    // <video> 视频资源加载完毕后执行；
    video.addEventListener("loadeddata", () => {
        canvas.setAttribute('height', video.videoHeight);
        canvas.setAttribute('width', video.videoWidth);
        clientX = canvas.clientWidth;
        clientY = canvas.clientHeight;
        draw();
    });
}

function calcFPS (duration) {
    // 提取容器中的前 20 个元素来计算平均值；
    const AVERAGE_RECORDS_COUNT = 20;
    vector.push(duration);
    if (vector.length > AVERAGE_RECORDS_COUNT) {
        vector.shift();  // 维护容器大小；
    } else {
        return 'NaN';
    }
    // 计算平均每帧在绘制过程中所消耗的时间；
    let averageTime = (vector.reduce((pre, item) => { 
        return pre + item;
    }, 0) / AVERAGE_RECORDS_COUNT);
    // 估算出 1s 内能够绘制的帧数；
    // console.log(averageTime, vector)
    return (1000 / averageTime).toFixed(2);
}

function filterJS(pixelData, width, height) {
    return jsConvFilter(pixelData, width, height, kernel);
}


function jsConvFilter(data, width, height, kernel) {
    const divisor = 4;  // 分量调节参数；
    const h = kernel.length, w = h;  // 保存卷积核数组的宽和高；
    const half = Math.floor(h / 2);
    // 根据卷积核的大小来忽略对边缘像素的处理；
    for (let y = half; y < height - half; ++y) {
        for (let x = half; x < width - half; ++x) {
            // 每个像素点在像素分量数组中的起始位置；
            const px = (y * width + x) * 4;  
            let r = 0, g = 0, b = 0;
            // 与卷积核矩阵数组进行运算；
            for (let cy = 0; cy < h; ++cy) {
            for (let cx = 0; cx < w; ++cx) {
                // 获取卷积核矩阵所覆盖位置的每一个像素的起始偏移位置；
                const cpx = ((y + (cy - half)) * width + (x + (cx - half))) * 4;
                // 对卷积核中心像素点的 RGB 各分量进行卷积计算(累加)；
                r += data[cpx + 0] * kernel[cy][cx];
                g += data[cpx + 1] * kernel[cy][cx];
                b += data[cpx + 2] * kernel[cy][cx];
            }
            }
            // 处理 RGB 三个分量的卷积结果；
            data[px + 0] = ((r / divisor) > 255) ? 255 : ((r / divisor) < 0) ? 0 : r / divisor;
            data[px + 1] = ((g / divisor) > 255) ? 255 : ((g / divisor) < 0) ? 0 : g / divisor;
            data[px + 2] = ((b / divisor) > 255) ? 255 : ((b / divisor) < 0) ? 0 : b / divisor;
        }
    }
    return data;
}

listenVideoMode();
playWithCanvas();