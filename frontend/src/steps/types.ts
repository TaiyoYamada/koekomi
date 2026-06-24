/** 各ステップに渡す共通の操作。 */
export interface StepProps {
  /** ステップ番号（1始まり, 表示用）。 */
  stepNumber: number
  goNext: () => void
  goBack: () => void
  isFirst: boolean
  isLast: boolean
}
