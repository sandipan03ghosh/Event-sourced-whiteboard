import React from 'react';
import styles from './ErrorBoundary.module.css';

// Class component only because error boundaries require componentDidCatch/
// getDerivedStateFromError — no hook equivalent exists yet. Only catches
// render-phase errors in its subtree; event handlers and socket callbacks
// are unaffected either way.
class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error, info) {
    console.error('Unhandled error in component tree:', error, info);
  }

  handleReload = () => {
    window.location.reload();
  };

  render() {
    if (this.state.hasError) {
      return (
        <div className={styles.page}>
          <div className={styles.card}>
            <h2 className={styles.title}>Something went wrong</h2>
            <p className={styles.message}>
              The app hit an unexpected error. Reloading usually fixes it — anything already saved to the room stays safe.
            </p>
            <button type="button" className={styles.button} onClick={this.handleReload}>
              Reload
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;
