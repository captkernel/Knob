import { motion } from 'framer-motion'
import { Download } from 'lucide-react'

/**
 * Quiet update toast: rendered ONLY when an update has finished downloading and
 * is ready to install. Checking/downloading/error states render nothing.
 */
export function UpdateToast({
  version,
  onRestart
}: {
  version?: string
  onRestart: () => void
}): JSX.Element {
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 10 }}
      className="no-drag absolute bottom-3 left-3 right-3 z-20 flex items-center gap-2 rounded-xl border border-accent/40 bg-accent/15 px-3 py-2 text-xs text-white shadow-panel backdrop-blur-xl"
    >
      <Download size={14} className="shrink-0" />
      <span className="flex-1">
        Update{version ? ` ${version}` : ''} ready to install.
      </span>
      <button
        onClick={onRestart}
        className="shrink-0 rounded-lg border border-white/20 bg-white/10 px-2.5 py-1 font-medium transition-colors hover:bg-white/20"
      >
        Restart
      </button>
    </motion.div>
  )
}
