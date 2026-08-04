<script setup>
import { onMounted, ref } from 'vue'
import { useRoute } from 'vue-router'
import { useHead } from '@unhead/vue'
import { useScopedI18n } from '@/i18n/app'

import { useGlobalState } from '../store'
import { api } from '../api'
import MailBox from '../components/MailBox.vue'
import { isValidPublicToken } from '../utils/public-link'

const route = useRoute()
const message = useMessage()
const { t } = useScopedI18n('views.PublicMail')
const { openSettings } = useGlobalState()

const token = typeof route.params.token === 'string' ? route.params.token : ''
const invalidToken = ref(!isValidPublicToken(token))
const rateLimited = ref(false)
const mailboxAddress = ref('')

useHead({
    title: () => t('publicMailbox'),
    meta: [{ name: 'referrer', content: 'no-referrer' }],
})

onMounted(async () => {
    await api.getOpenSettings()
})

const fetchMailData = async (limit, offset) => {
    if (!isValidPublicToken(token)) {
        invalidToken.value = true
        return { results: [], count: 0 }
    }
    try {
        const response = await api.fetch(
            `/public_api/mails?limit=${limit}&offset=${offset}`,
            { headers: { 'x-public-token': token } }
        )
        mailboxAddress.value = response.address || ''
        return response
    } catch (error) {
        const msg = error.message || ''
        if (msg.startsWith('[404]')) invalidToken.value = true
        else if (msg.startsWith('[429]')) rateLimited.value = true
        else message.error(msg)
        throw error
    }
}
</script>

<template>
    <div class="public-mail">
        <n-card v-if="invalidToken" :bordered="false" embedded class="state-card">
            <n-result status="404" :title="t('invalidLink')" :description="t('invalidLinkTip')" />
        </n-card>
        <n-card v-else-if="rateLimited" :bordered="false" embedded class="state-card">
            <n-result status="error" title="429" :description="t('rateLimited')" />
        </n-card>
        <template v-else>
            <n-card :bordered="false" embedded class="header-card">
                <n-flex align="center" justify="space-between" :wrap="false">
                    <span class="title">{{ openSettings.title || t('publicMailbox') }}</span>
                    <n-tag v-if="mailboxAddress" type="info" size="small">
                        {{ t('address') }}: {{ mailboxAddress }}
                    </n-tag>
                </n-flex>
            </n-card>
            <MailBox :showEMailTo="true" :enableUserDeleteEmail="false" :showReply="false"
                :showSaveS3="false" :showFilterInput="true" :fetchMailData="fetchMailData" />
        </template>
    </div>
</template>

<style scoped>
.public-mail {
    max-width: 1200px;
    margin: 0 auto;
    padding: 0 12px;
}

.state-card {
    max-width: 720px;
    margin: 20px auto;
}

.header-card {
    margin-top: 10px;
    margin-bottom: 10px;
}

.title {
    font-size: 16px;
    font-weight: 600;
}
</style>
