import { Component, type ReactNode } from 'react'

interface Props { children: ReactNode }
interface State { error: string | null }

export default class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(e: Error): State {
    return { error: e.message }
  }

  render() {
    if (this.state.error) {
      return (
        <div className="min-h-screen bg-[#0a0f1e] flex items-center justify-center p-6">
          <div className="bg-red-500/10 border border-red-500/30 rounded-2xl p-6 max-w-lg w-full text-center">
            <p className="text-red-400 font-bold text-lg mb-2">เกิดข้อผิดพลาด</p>
            <p className="text-slate-400 text-sm mb-4 font-mono break-all">{this.state.error}</p>
            <button onClick={() => window.location.reload()}
              className="bg-brand-600 hover:bg-brand-500 text-white px-6 py-2.5 rounded-xl font-semibold transition-colors">
              รีโหลดหน้า
            </button>
          </div>
        </div>
      )
    }
    return this.props.children
  }
}
