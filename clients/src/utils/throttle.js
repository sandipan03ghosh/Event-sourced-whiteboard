// Leading+trailing edge throttle: fires immediately, then at most once per `wait` ms.
export function throttle(fn, wait) {
  let lastCallTime = 0;
  let timer = null;

  return (...args) => {
    const now = Date.now();
    const remaining = wait - (now - lastCallTime);

    if (remaining <= 0) {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      lastCallTime = now;
      fn(...args);
    } else {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        lastCallTime = Date.now();
        timer = null;
        fn(...args);
      }, remaining);
    }
  };
}
