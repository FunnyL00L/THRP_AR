/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useRef, useEffect, Suspense, useMemo } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { Environment, useGLTF } from '@react-three/drei';
import * as THREE from 'three';
import jsQR from 'jsqr';
import { X, Info, ChevronLeft, ChevronRight, HelpCircle } from 'lucide-react';

// Data Interface (Same as App.tsx)
interface ModelData {
  id: string;
  name: string;
  description: string;
  file_url: string;
  file_name: string;
  audio_url: string;
  image_urls: string[];
  category: string;
  category_id: string;
  img_cover: string;
}

function GLBModel({ url }: { url: string }) {
  const { scene } = useGLTF(url);
  const clone = useMemo(() => scene.clone(), [scene, url]);
  return <primitive object={clone} />;
}

/**
 * Komponen untuk menghitung posisi 3D berdasarkan koordinat QR di layar
 */
function QRTracker({ 
  qrData, 
  onDetected, 
  onLost, 
  modelUrl, 
  rotationY,
  videoRef 
}: { 
  qrData: string, 
  onDetected: (pos: THREE.Vector3, scale: number) => void, 
  onLost: () => void,
  modelUrl: string,
  rotationY: number,
  videoRef: React.RefObject<HTMLVideoElement>
}) {
  const { viewport, camera } = useThree();
  const [targetPos, setTargetPos] = useState<THREE.Vector3 | null>(null);
  const [targetScale, setTargetScale] = useState(1);
  const [isVisible, setIsVisible] = useState(false);
  
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  
  useEffect(() => {
    if (!canvasRef.current) {
      canvasRef.current = document.createElement('canvas');
    }
  }, []);

  const lastDetectionTime = useRef(0);

  useFrame(() => {
    if (!videoRef.current || videoRef.current.readyState !== videoRef.current.HAVE_ENOUGH_DATA || !canvasRef.current) return;

    const video = videoRef.current;
    const canvas = canvasRef.current;
    const context = canvas.getContext('2d', { willReadFrequently: true });

    if (!context) return;

    // Set canvas size to match video
    if (canvas.width !== video.videoWidth || canvas.height !== video.videoHeight) {
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
    }

    context.drawImage(video, 0, 0, canvas.width, canvas.height);
    const imageData = context.getImageData(0, 0, canvas.width, canvas.height);
    const code = jsQR(imageData.data, imageData.width, imageData.height, {
      inversionAttempts: "dontInvert",
    });

    if (code && code.data === qrData) {
      lastDetectionTime.current = Date.now();
      setIsVisible(true);

      // Hitung pusat QR dalam koordinat piksel
      const corners = code.location;
      const centerX = (corners.topLeftCorner.x + corners.topRightCorner.x + corners.bottomRightCorner.x + corners.bottomLeftCorner.x) / 4;
      const centerY = (corners.topLeftCorner.y + corners.topRightCorner.y + corners.bottomRightCorner.y + corners.bottomLeftCorner.y) / 4;

      // Hitung skala berdasarkan jarak antar pojok (estimasi ukuran QR di layar)
      const side1 = Math.sqrt(Math.pow(corners.topRightCorner.x - corners.topLeftCorner.x, 2) + Math.pow(corners.topRightCorner.y - corners.topLeftCorner.y, 2));
      const side2 = Math.sqrt(Math.pow(corners.bottomRightCorner.x - corners.topRightCorner.x, 2) + Math.pow(corners.bottomRightCorner.y - corners.topRightCorner.y, 2));
      const avgSide = (side1 + side2) / 2;
      
      // Konversi koordinat piksel ke NDC (-1 ke 1)
      const ndcX = (centerX / canvas.width) * 2 - 1;
      const ndcY = -(centerY / canvas.height) * 2 + 1;

      // Proyeksikan ke dunia 3D
      // Kita asumsikan QR berada pada jarak tertentu (z) yang berbanding terbalik dengan ukuran QR di layar
      const distance = 500 / avgSide; // Konstanta 500 adalah angka ajaib untuk kalibrasi visual
      
      const vector = new THREE.Vector3(ndcX, ndcY, 0.5);
      vector.unproject(camera);
      const dir = vector.sub(camera.position).normalize();
      const pos = camera.position.clone().add(dir.multiplyScalar(distance));
      
      setTargetPos(pos);
      setTargetScale(avgSide / 100); // Skala objek relatif terhadap ukuran QR
    } else {
      // Jika tidak terdeteksi selama lebih dari 500ms, anggap hilang
      if (Date.now() - lastDetectionTime.current > 500) {
        setIsVisible(false);
        onLost();
      }
    }
  });

  if (!isVisible || !targetPos) return null;

  return (
    <group position={targetPos} scale={[targetScale, targetScale, targetScale]} rotation={[0, rotationY, 0]}>
      <Suspense fallback={null}>
        <GLBModel url={modelUrl} />
      </Suspense>
    </group>
  );
}

export default function QRScan({ 
  arData, 
  objectIndex, 
  onClose,
  onNext,
  onPrev,
  setInfoModal
}: { 
  arData: ModelData[], 
  objectIndex: number, 
  onClose: () => void,
  onNext: () => void,
  onPrev: () => void,
  setInfoModal: (info: ModelData | null) => void
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [rotationY, setRotationY] = useState(0);
  const [isCameraReady, setIsCameraReady] = useState(false);
  const [isDetected, setIsDetected] = useState(false);

  useEffect(() => {
    async function setupCamera() {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ 
          video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } } 
        });
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          videoRef.current.onloadedmetadata = () => {
            setIsCameraReady(true);
          };
        }
      } catch (err) {
        console.error("Error accessing camera:", err);
        alert("Gagal mengakses kamera. Pastikan izin kamera diberikan.");
      }
    }
    setupCamera();

    return () => {
      if (videoRef.current && videoRef.current.srcObject) {
        const stream = videoRef.current.srcObject as MediaStream;
        stream.getTracks().forEach(track => track.stop());
      }
    };
  }, []);

  const handleTouchStart = (e: React.TouchEvent) => {
    const startX = e.touches[0].clientX;
    const startY = e.touches[0].clientY;
    const startRotY = rotationY;
    
    const handleTouchMove = (moveEvent: TouchEvent) => {
      const deltaX = moveEvent.touches[0].clientX - startX;
      const deltaY = moveEvent.touches[0].clientY - startY;

      // Jika swipe ke bawah secara signifikan, kembali ke dashboard
      if (deltaY > 150) {
        document.removeEventListener('touchmove', handleTouchMove);
        document.removeEventListener('touchend', handleTouchEnd);
        onClose();
        return;
      }

      setRotationY(startRotY + deltaX * 0.01);
    };

    const handleTouchEnd = () => {
      document.removeEventListener('touchmove', handleTouchMove);
      document.removeEventListener('touchend', handleTouchEnd);
    };

    document.addEventListener('touchmove', handleTouchMove);
    document.addEventListener('touchend', handleTouchEnd);
  };

  const currentModel = arData[objectIndex];

  return (
    <div className="fixed inset-0 bg-black z-[100] flex flex-col overflow-hidden">
      {/* Video Feed */}
      <video 
        ref={videoRef} 
        autoPlay 
        playsInline 
        muted 
        className="absolute inset-0 w-full h-full object-cover"
      />

      {/* 3D Overlay */}
      {isCameraReady && (
        <div className="absolute inset-0 z-10 pointer-events-none">
          <Canvas camera={{ position: [0, 0, 5], fov: 50 }}>
            <ambientLight intensity={0.8} />
            <directionalLight position={[10, 10, 10]} intensity={1} />
            <Environment preset="city" />
            
            <QRTracker 
              qrData="TRHP-AR-MARKER" // Menggunakan marker tunggal untuk semua model
              modelUrl={currentModel.file_url}
              rotationY={rotationY}
              videoRef={videoRef}
              onDetected={() => setIsDetected(true)}
              onLost={() => setIsDetected(false)}
            />
          </Canvas>
        </div>
      )}

      {/* UI Overlay */}
      <div className="absolute inset-0 z-20 pointer-events-none flex flex-col">
        {/* Top Bar */}
        <div className="p-6 flex justify-between items-start pointer-events-auto">
          <div className="bg-black/60 backdrop-blur-md px-4 py-2 rounded-xl border border-white/10 text-white shadow-lg">
            <div className="flex flex-col items-center gap-2">
              <div className={`w-2 h-2 rounded-full ${isDetected ? 'bg-emerald-500 animate-pulse' : 'bg-red-500'}`} />
              <span className="text-xs font-medium uppercase tracking-wider">
                {isDetected ? 'Marker Terdeteksi' : 'Mencari Marker...'}
              </span>
            </div>
            <p className="text-[10px] text-zinc-400 mt-1">Arahkan kamera ke Master QR Code untuk memunculkan: <span className="text-white font-bold">{currentModel.name}</span></p>
          </div>

          <button
            onClick={onClose}
            className="bg-red-500/80 backdrop-blur-md p-2 rounded-xl border border-red-400/30 text-white hover:bg-red-500 transition-all shadow-lg"
          >
            <X size={20} />
          </button>
        </div>

        {/* Center Guide (Optional) */}
        {!isDetected && (
          <div className="flex-1 flex items-center justify-center">
            <div className="w-64 h-64 border-2 border-dashed border-white/30 rounded-3xl flex items-center justify-center">
              <p className="text-white/50 text-xs text-center px-8">Posisikan QR Code di dalam kotak ini</p>
            </div>
          </div>
        )}

        {/* Bottom Controls */}
        <div className="mt-auto p-12 flex flex-col items-center gap-4 pointer-events-auto">
          {isDetected && (
            <button
              onClick={() => setInfoModal(currentModel)}
              className="bg-black/60 backdrop-blur-md px-5 py-2.5 rounded-full border border-white/20 text-white hover:bg-white/20 transition-all shadow-lg flex items-center gap-2"
            >
              <Info size={18} className="text-blue-400" />
              <span className="text-sm font-medium">Informasi Objek</span>
            </button>
          )}

          <div className="bg-black/60 backdrop-blur-md p-2 rounded-2xl flex items-center gap-2 border border-white/10 shadow-2xl">
            <button onClick={onPrev} className="p-3 text-white hover:bg-white/10 rounded-xl transition-colors">
              <ChevronLeft size={24} />
            </button>
            
            <div className="w-16 h-16 flex items-center justify-center rounded-xl bg-white/10 overflow-hidden border border-white/20">
              <img src={currentModel.img_cover} alt="Icon" className="w-full h-full object-cover" crossOrigin="anonymous" />
            </div>

            <button onClick={onNext} className="p-3 text-white hover:bg-white/10 rounded-xl transition-colors">
              <ChevronRight size={24} />
            </button>
          </div>
        </div>
      </div>

      {/* Interaction Layer for Rotation */}
      <div 
        className="absolute inset-0 z-15 pointer-events-auto"
        onTouchStart={handleTouchStart}
      />
    </div>
  );
}
