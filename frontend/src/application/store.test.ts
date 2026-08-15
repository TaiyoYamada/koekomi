import { describe, expect, it, vi } from 'vitest'
import { createStore } from './store'

describe('createStore', () => {
  it('購読者に変更を伝える', () => {
    const store = createStore({ n: 0 })
    const seen = vi.fn()
    store.subscribe(seen)
    store.set({ n: 1 })
    expect(seen).toHaveBeenCalledTimes(1)
    expect(store.get()).toEqual({ n: 1 })
  })

  it('同じ参照をセットしても通知しない（無駄な再描画を起こさない）', () => {
    const initial = { n: 0 }
    const store = createStore(initial)
    const seen = vi.fn()
    store.subscribe(seen)
    store.set(initial)
    store.set((s) => s)
    expect(seen).not.toHaveBeenCalled()
  })

  it('関数で更新できる', () => {
    const store = createStore({ n: 1 })
    store.set((s) => ({ n: s.n + 1 }))
    expect(store.get().n).toBe(2)
  })

  it('解除できる', () => {
    const store = createStore({ n: 0 })
    const seen = vi.fn()
    const off = store.subscribe(seen)
    off()
    store.set({ n: 1 })
    expect(seen).not.toHaveBeenCalled()
  })

  it('通知中に解除されても、その回の通知は最後まで走る', () => {
    const store = createStore({ n: 0 })
    const second = vi.fn()
    const off = store.subscribe(() => off())
    store.subscribe(second)
    expect(() => store.set({ n: 1 })).not.toThrow()
    expect(second).toHaveBeenCalledTimes(1)
  })
})
