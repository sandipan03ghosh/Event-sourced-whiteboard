import React, { useRef, useEffect } from 'react';
import socket from '../socket';

function DrawingCanvas() {
  const canvasRef = useRef();
  const isDrawing = useRef(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;

    const drawLine = ({ x0, y0, x1, y1, color, width }) => {
      ctx.beginPath();
      ctx.strokeStyle = color;
      ctx.lineWidth = width;
      ctx.moveTo(x0, y0);
      ctx.lineTo(x1, y1);
      ctx.stroke();
    };

    const handleDraw = (data) => drawLine(data);
    socket.on('draw-move', handleDraw);

    const handleClear = () => ctx.clearRect(0, 0, canvas.width, canvas.height);
    window.addEventListener('clearCanvas', () => {
      handleClear();
      socket.emit('clear-canvas');
    });

    socket.on('load-drawings', (drawings) => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      drawings.forEach((item) => {
        if (item.type === 'stroke' && item.data) {
          const { x0, y0, x1, y1, color, width } = item.data;
          drawLine({ x0, y0, x1, y1, color: color || 'black', width: width || 3 });
        }
      });
    });

    socket.on('clear-canvas', handleClear);

    window.addEventListener('clearMyDrawings', () => {
      socket.emit('clear-user-drawings');
    });

    return () => {
      socket.off('draw-move', handleDraw);
      socket.off('clear-canvas', handleClear);
      socket.off('load-drawings');
      window.removeEventListener('clearMyDrawings');
    };
  }, []);

  const getMousePos = (e) => ({ x: e.clientX, y: e.clientY });

  const handleMouseDown = (e) => {
    isDrawing.current = true;
    const { x, y } = getMousePos(e);
    canvasRef.current.lastX = x;
    canvasRef.current.lastY = y;
  };

  const handleMouseMove = (e) => {
    if (!isDrawing.current) return;
    const canvas = canvasRef.current;
    const { x: x0, y: y0 } = { x: canvas.lastX, y: canvas.lastY };
    const { x: x1, y: y1 } = getMousePos(e);
    const color = document.getElementById('color').value;
    const width = document.getElementById('width').value;

    const data = { x0, y0, x1, y1, color, width };
    socket.emit('draw-move', data);
    const ctx = canvas.getContext('2d');
    ctx.beginPath();
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.moveTo(x0, y0);
    ctx.lineTo(x1, y1);
    ctx.stroke();

    canvas.lastX = x1;
    canvas.lastY = y1;
  };

  const handleMouseUp = () => {
    isDrawing.current = false;
  };

  return (
    <canvas
      ref={canvasRef}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
    />
  );
}

export default DrawingCanvas;
