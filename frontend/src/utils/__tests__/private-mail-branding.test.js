import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

import { MESSAGE_REGISTRY } from '../../i18n/message-registry'
import { isPublicMailRoute } from '../private-mail-route'

const frontendRoot = resolve(import.meta.dirname, '../../..')
const readFrontendFile = (relativePath) =>
    readFileSync(resolve(frontendRoot, relativePath), 'utf8')

describe('Private Mail branding contract', () => {
    it('waits for the initial router resolution before mounting the app', () => {
        const mainSource = readFrontendFile('src/main.js')

        expect(mainSource).toMatch(/await router\.isReady\(\)/)
    })

    it('uses the requested English and Chinese visible brand', () => {
        expect(MESSAGE_REGISTRY['views.Header'].title).toEqual({
            en: 'Private Mail',
            zh: '私有邮箱',
        })
        expect(MESSAGE_REGISTRY['views.Footer'].brand).toEqual({
            en: 'Private Mail',
            zh: '私有邮箱',
        })
    })

    it('classifies both public mailbox route forms without changing route paths', () => {
        expect(isPublicMailRoute('/m/Ab3xY9zKq2')).toBe(true)
        expect(isPublicMailRoute('/en/m/Ab3xY9zKq2')).toBe(true)
        expect(isPublicMailRoute('/zh-CN/m/Ab3xY9zKq2')).toBe(true)
        expect(isPublicMailRoute('/')).toBe(false)
        expect(isPublicMailRoute('/user')).toBe(false)

        const routerSource = readFrontendFile('src/router/index.js')
        const routeBlock = routerSource.match(/path: '\/m\/:token'[\s\S]*?component: \(\) => import\('\.\.\/views\/PublicMail\.vue'\)/)?.[0]

        expect(routeBlock).toContain("path: '/m/:token'")
        expect(routeBlock).toContain("alias: '/:lang/m/:token'")
    })

    it('keeps the public mailbox read-only and content-focused', () => {
        const publicMailSource = readFrontendFile('src/views/PublicMail.vue')

        expect(publicMailSource).toContain('<MailBox')
        expect(publicMailSource).toMatch(/:showEMailTo="true"/)
        expect(publicMailSource).toMatch(/:enableUserDeleteEmail="false"/)
        expect(publicMailSource).toMatch(/:showReply="false"/)
        expect(publicMailSource).toMatch(/:showSaveS3="false"/)
        expect(publicMailSource).toMatch(/:showFilterInput="true"/)
        expect(publicMailSource).toContain(':fetchMailData="fetchMailData"')
        expect(publicMailSource).not.toContain('openSettings.title')
    })

    it('uses the neutral icon in frontend metadata when the asset exists', () => {
        const iconPath = 'public/private-mail-icon.svg'
        const iconSource = existsSync(resolve(frontendRoot, iconPath))
            ? readFrontendFile(iconPath)
            : ''
        const htmlSource = readFrontendFile('index.html')
        const pwaSource = readFrontendFile('vite.config.js')

        expect(iconSource).toBeTruthy()
        expect(iconSource).not.toMatch(/Cloudflare|temporary|临时邮件|github/i)
        expect(`${htmlSource}\n${pwaSource}`).toContain('private-mail-icon.svg')
    })

    it('does not expose the old visible brand in normal branding sources', () => {
        const sourcePaths = [
            'index.html',
            'vite.config.js',
            'src/views/Header.vue',
            'src/views/Footer.vue',
            'src/i18n/message-registry.ts',
            'src/i18n/locales/source/de.ts',
            'src/i18n/locales/source/es.ts',
            'src/i18n/locales/source/ja.ts',
            'src/i18n/locales/source/ptBR.ts',
        ]

        for (const sourcePath of sourcePaths) {
            expect(readFrontendFile(sourcePath), sourcePath).not.toMatch(
                /Cloudflare Temp Email|Cloudflare 临时邮件|Cloudflare Temporäre E-Mail|Cloudflare Correo Temporal|Cloudflare 一時メール|Cloudflare E-mail Temporário/i,
            )
        }
    })

    it('removes repository and source links from credential-related views', () => {
        const aboutSource = readFrontendFile('src/views/common/About.vue')
        const credentialSource = readFrontendFile('src/components/AddressCredentialModal.vue')

        expect(aboutSource).not.toMatch(/github\.com|cloudflare_temp_email/i)
        expect(credentialSource).not.toMatch(/github\.com|cloudflare_temp_email|temp-mail-docs/i)
        expect(credentialSource).not.toContain('agentSkillUrl')
    })

    it('keeps public route metadata content-only and uses the shared header icon', () => {
        const publicMailSource = readFrontendFile('src/views/PublicMail.vue')
        const headerSource = readFrontendFile('src/views/Header.vue')

        expect(publicMailSource).toMatch(/name: ['"]description['"], content: \(\) => t\(['"]publicMailbox['"]\)/)
        expect(publicMailSource).not.toMatch(/Private Mail|私有邮箱|openSettings/i)
        expect(headerSource).toContain('src="/private-mail-icon.svg"')
        expect(headerSource).not.toContain('EmailOutlined')
        expect(headerSource).not.toContain('LockFilled')
    })
})
