import { io } from 'socket.io-client';

export async function apiRequest(path, options = {}) {
  const res = await fetch(path, {
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
    ...options,
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error || 'Ошибка запроса к серверу');
  }
  return data;
}

export function createSocket() {
  return io({
    transports: ['websocket', 'polling'],
  });
}
