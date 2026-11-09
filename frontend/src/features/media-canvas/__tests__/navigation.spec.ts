import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import en from '@/i18n/locales/en'
import zh from '@/i18n/locales/zh'

const here = dirname(fileURLToPath(import.meta.url))
const read = (relativePath: string) => readFileSync(resolve(here, relativePath), 'utf8')

describe('Media Canvas navigation and locale integration', () => {
  it('registers a lazy, authenticated route for regular users and admins', () => {
    const router = read('../../../router/index.ts')
    const routeStart = router.indexOf("path: '/media-canvas'")
    expect(routeStart).toBeGreaterThan(-1)

    const route = router.slice(routeStart, router.indexOf('\n  },', routeStart))
    expect(route).toContain("name: 'MediaCanvas'")
    expect(route).toContain("import('@/views/user/MediaCanvasView.vue')")
    expect(route).toContain('requiresAuth: true')
    expect(route).toContain('requiresAdmin: false')
    expect(route).toContain("titleKey: 'nav.mediaCanvas'")
    expect(router).toContain("const requiresAuth = to.meta.requiresAuth !== false")
    expect(router).toContain('const requiresAdmin = to.meta.requiresAdmin === true')
  })

  it('adds the canvas to the shared user and admin personal navigation', () => {
    const sidebar = read('../../../components/layout/AppSidebar.vue')
    const selfNavigation = sidebar.slice(
      sidebar.indexOf('function buildSelfNavItems'),
      sidebar.indexOf('// finalizeNav', sidebar.indexOf('function buildSelfNavItems'))
    )

    expect(selfNavigation).toContain("path: '/media-canvas'")
    expect(selfNavigation).toContain("label: t('nav.mediaCanvas')")
    expect(sidebar).toContain('finalizeNav(buildSelfNavItems(true))')
    expect(sidebar).toContain('finalizeNav(buildSelfNavItems(false))')
  })

  it('provides matching Chinese and English canvas messages for page controls', () => {
    expect(zh.nav.mediaCanvas).toBeTruthy()
    expect(en.nav.mediaCanvas).toBeTruthy()
    expect(Object.keys(zh.mediaCanvas)).toEqual(Object.keys(en.mediaCanvas))
    expect(Object.keys(zh.mediaCanvas.errors)).toEqual(Object.keys(en.mediaCanvas.errors))

    for (const locale of [zh, en]) {
      expect(locale.mediaCanvas.title).toBeTruthy()
      expect(locale.mediaCanvas.image).toBeTruthy()
      expect(locale.mediaCanvas.video).toBeTruthy()
      expect(locale.mediaCanvas.generate).toBeTruthy()
      expect(locale.mediaCanvas.privacyNote).toBeTruthy()
      expect(locale.mediaCanvas.history).toBeTruthy()
      expect(locale.mediaCanvas.errors.generation).toBeTruthy()
    }
  })
})
