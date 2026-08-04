<script setup>
import { computed } from 'vue'
import { Discord } from '@vicons/fa'
import { useGlobalState } from '../../store'
import { sanitizeHtml } from '../../utils/sanitize-html'
const { announcement } = useGlobalState()
const safeAnnouncement = computed(() => sanitizeHtml(announcement.value))
</script>

<template>
    <div class="center">
        <n-card :bordered="false" embedded>
            <div v-html="safeAnnouncement"></div>
            <n-button tag="a" target="_blank" href="https://discord.gg/dQEwTWhA6Q">
                <template #icon>
                    <n-icon :component="Discord" />
                </template>
                Discord
            </n-button>
        </n-card>
    </div>
</template>

<style scoped>
.center {
    display: flex;
    justify-content: center;
}

.n-card {
    max-width: 800px;
}

.n-button {
    margin-top: 10px;
    margin-left: 10px;
}
</style>
