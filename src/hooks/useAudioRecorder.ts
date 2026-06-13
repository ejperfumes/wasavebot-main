// src/hooks/useAudioRecorder.ts
import { useState, useRef, useCallback, useEffect } from 'react';

const useAudioRecorder = () => {
  // ─── Estado reactivo (para re-render) ────────────────────────────────────
  const [isRecording, setIsRecording]     = useState(false);
  const [isPaused, setIsPaused]           = useState(false);
  const [recordingTime, setRecordingTime] = useState(0);
  const [audioBlob, setAudioBlob]         = useState<Blob | null>(null);
  const [error, setError]                 = useState<string | null>(null);

  // ─── Refs para lógica interna (sin causar re-renders ni cambiar deps) ─────
  const mediaRecorderRef  = useRef<MediaRecorder | null>(null);
  const audioChunksRef    = useRef<Blob[]>([]);
  const streamRef         = useRef<MediaStream | null>(null);
  const timerRef          = useRef<ReturnType<typeof setInterval> | null>(null);

  // Mirrors de estado como refs → se usan dentro de callbacks estables
  const isRecordingRef    = useRef(false);
  const isPausedRef       = useRef(false);

  // Mantener refs sincronizados con estado
  useEffect(() => { isRecordingRef.current = isRecording; }, [isRecording]);
  useEffect(() => { isPausedRef.current = isPaused; }, [isPaused]);

  // ─── Helpers de timer (estables, sin deps de estado) ─────────────────────

  const stopTimer = useCallback(() => {
    if (timerRef.current !== null) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const startTimer = useCallback(() => {
    stopTimer();
    timerRef.current = setInterval(() => {
      setRecordingTime((prev) => prev + 1);
    }, 1000);
  }, [stopTimer]);

  // ─── reset ────────────────────────────────────────────────────────────────

  const reset = useCallback(() => {
    stopTimer();
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    if (mediaRecorderRef.current) {
      mediaRecorderRef.current.onstop = null;
      mediaRecorderRef.current = null;
    }
    audioChunksRef.current = [];
    isRecordingRef.current = false;
    isPausedRef.current    = false;
    setIsRecording(false);
    setIsPaused(false);
    setRecordingTime(0);
    setAudioBlob(null);
    setError(null);
  }, [stopTimer]);

  // ─── startRecording ───────────────────────────────────────────────────────

  const startRecording = useCallback(async () => {
    reset();
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current  = stream;

      // Preferir ogg/opus (compatible con whatsapp-web.js sendAudioAsVoice)
      // Si el navegador no lo soporta, usar el formato por defecto (webm)
      const preferredMime = 'audio/ogg; codecs=opus';
      const mimeType = MediaRecorder.isTypeSupported(preferredMime)
        ? preferredMime
        : '';
      const mr = mimeType
        ? new MediaRecorder(stream, { mimeType })
        : new MediaRecorder(stream);
      mediaRecorderRef.current = mr;

      mr.ondataavailable = (e) => {
        if (e.data.size > 0) audioChunksRef.current.push(e.data);
      };

      mr.onstop = () => {
        const blobMime = mr.mimeType || 'audio/ogg';
        const blob = new Blob(audioChunksRef.current, { type: blobMime });
        setAudioBlob(blob);
        isRecordingRef.current = false;
        isPausedRef.current    = false;
        setIsRecording(false);
        setIsPaused(false);
        stopTimer();
        if (streamRef.current) {
          streamRef.current.getTracks().forEach((t) => t.stop());
          streamRef.current = null;
        }
      };

      mr.start();
      isRecordingRef.current = true;
      isPausedRef.current    = false;
      setIsRecording(true);
      setIsPaused(false);
      setRecordingTime(0);
      startTimer();
    } catch (err) {
      setError('No se pudo acceder al micrófono');
      console.error(err);
    }
  }, [reset, startTimer, stopTimer]);

  // ─── pauseRecording ───────────────────────────────────────────────────────
  // Usa refs → callback ESTABLE, no cambia entre renders

  const pauseRecording = useCallback(() => {
    if (mediaRecorderRef.current && isRecordingRef.current && !isPausedRef.current) {
      mediaRecorderRef.current.pause();
      isPausedRef.current = true;
      setIsPaused(true);
      stopTimer();   // ← congela el contador
    }
  }, [stopTimer]);   // ← sin isRecording/isPaused en deps → callback estable

  // ─── resumeRecording ──────────────────────────────────────────────────────

  const resumeRecording = useCallback(() => {
    if (mediaRecorderRef.current && isRecordingRef.current && isPausedRef.current) {
      mediaRecorderRef.current.resume();
      isPausedRef.current = false;
      setIsPaused(false);
      startTimer();   // ← reactiva el contador
    }
  }, [startTimer]);  // ← callback estable

  // ─── stopRecording ────────────────────────────────────────────────────────

  const stopRecording = useCallback(() => {
    if (mediaRecorderRef.current && isRecordingRef.current) {
      stopTimer();
      mediaRecorderRef.current.stop();
    }
  }, [stopTimer]);

  // ─── cancelRecording ──────────────────────────────────────────────────────

  const cancelRecording = useCallback(() => {
    if (mediaRecorderRef.current) {
      mediaRecorderRef.current.onstop = null;
      if (isRecordingRef.current) mediaRecorderRef.current.stop();
    }
    reset();
  }, [reset]);

  return {
    isRecording,
    isPaused,
    recordingTime,
    audioBlob,
    error,
    startRecording,
    pauseRecording,
    resumeRecording,
    stopRecording,
    cancelRecording,
    reset,
  };
};

export default useAudioRecorder;