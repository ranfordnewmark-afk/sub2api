<template>
  <AppLayout>
    <main class="mx-auto max-w-7xl space-y-6 px-4 pb-10 sm:px-6">
      <header class="space-y-2">
        <p class="text-xs font-semibold uppercase tracking-[0.2em] text-indigo-600 dark:text-indigo-300">
          Sub2API · Studio
        </p>
        <h1 class="text-3xl font-semibold tracking-tight text-gray-950 dark:text-white">
          {{ t('mediaCanvas.title') }}
        </h1>
      </header>

      <div class="grid gap-6 xl:grid-cols-[minmax(0,1.1fr)_minmax(360px,0.9fr)]">
        <section class="card space-y-6 p-5 sm:p-6">
          <div class="flex flex-wrap gap-2" role="tablist" :aria-label="t('mediaCanvas.title')">
            <button
              type="button"
              role="tab"
              :aria-selected="canvas.mode.value === 'image'"
              class="canvas-mode"
              :class="canvas.mode.value === 'image' ? 'canvas-mode-active' : ''"
              @click="canvas.mode.value = 'image'"
            >
              <span class="text-lg" aria-hidden="true">▧</span>{{ t('mediaCanvas.image') }}
            </button>
            <button
              type="button"
              role="tab"
              :aria-selected="canvas.mode.value === 'video'"
              class="canvas-mode"
              :class="canvas.mode.value === 'video' ? 'canvas-mode-active' : ''"
              @click="canvas.mode.value = 'video'"
            >
              <span class="text-lg" aria-hidden="true">▶</span>{{ t('mediaCanvas.video') }}
            </button>
          </div>

          <div class="grid gap-4 sm:grid-cols-2">
            <label class="field-label">
              <span>{{ t('mediaCanvas.key') }}</span>
              <select
                v-model="canvas.selectedKeyId.value"
                class="field-control"
                :disabled="canvas.loadingKeys.value"
              >
                <option value="">
                  {{ canvas.loadingKeys.value ? t('mediaCanvas.loading') : t('mediaCanvas.keyPlaceholder') }}
                </option>
                <option v-for="key in canvas.keyOptions.value" :key="key.id" :value="key.id">
                  {{ key.name }} · {{ key.groupName || t('mediaCanvas.groupDefault') }}
                </option>
              </select>
            </label>
            <label class="field-label">
              <span>{{ t('mediaCanvas.model') }}</span>
              <select
                v-model="canvas.modelId.value"
                class="field-control"
                :disabled="!canvas.keyOptions.value.length || canvas.loadingModels.value"
              >
                <option value="">
                  {{ canvas.loadingModels.value ? t('mediaCanvas.loading') : t('mediaCanvas.modelPlaceholder') }}
                </option>
                <option v-for="model in canvas.models.value" :key="model.id" :value="model.id">
                  {{ model.id }}
                </option>
              </select>
            </label>
          </div>

          <div
            v-if="!canvas.loadingKeys.value && !canvas.keyOptions.value.length"
            class="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-gray-50 p-4 text-sm dark:bg-dark-900"
          >
            <p class="text-gray-600 dark:text-gray-300">{{ t('mediaCanvas.noKeys') }}</p>
            <RouterLink to="/keys" class="text-indigo-600 hover:underline dark:text-indigo-300">
              {{ t('mediaCanvas.manageKeys') }}
            </RouterLink>
          </div>
          <div
            v-else-if="canvas.selectedKeyId.value && !canvas.loadingModels.value && !canvas.models.value.length && !canvas.error.value"
            class="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-gray-50 p-4 text-sm dark:bg-dark-900"
          >
            <p class="text-gray-600 dark:text-gray-300">{{ t('mediaCanvas.noModels') }}</p>
            <button type="button" class="text-indigo-600 hover:underline dark:text-indigo-300" @click="canvas.loadModels()">
              {{ t('mediaCanvas.retry') }}
            </button>
          </div>
          <div
            v-if="canvas.mode.value === 'video'"
            class="rounded-lg border border-indigo-100 bg-indigo-50 px-4 py-3 text-sm text-indigo-950 dark:border-indigo-900 dark:bg-indigo-950/40 dark:text-indigo-100"
          >
            {{ t('mediaCanvas.videoSupport') }}
          </div>

          <label class="field-label">
            <span>{{ t('mediaCanvas.prompt') }}</span>
            <textarea
              v-model="canvas.prompt.value"
              rows="5"
              maxlength="12000"
              class="field-control resize-y"
              :placeholder="t('mediaCanvas.promptPlaceholder')"
            />
          </label>

          <div class="grid gap-4 sm:grid-cols-2">
            <label class="field-label">
              <span>{{ canvas.mode.value === 'image' ? t('mediaCanvas.referenceImage') : t('mediaCanvas.firstFrame') }}</span>
              <input
                ref="fileInput"
                class="field-control file:mr-3 file:rounded-md file:border-0 file:bg-gray-100 file:px-3 file:py-1.5 file:text-sm dark:file:bg-dark-700"
                type="file"
                accept="image/png,image/jpeg,image/webp"
                @change="onFileChange"
              >
              <span class="text-xs font-normal text-gray-500 dark:text-gray-400">{{ t('mediaCanvas.uploadHint') }}</span>
            </label>
            <div
              v-if="canvas.upload.value"
              class="flex items-center justify-between gap-3 self-center rounded-lg border border-gray-200 p-3 text-sm dark:border-dark-700"
            >
              <span class="truncate">{{ canvas.upload.value.name }}</span>
              <button type="button" class="text-indigo-600 hover:underline dark:text-indigo-300" @click="clearFile">
                {{ t('mediaCanvas.removeImage') }}
              </button>
            </div>
          </div>

          <div v-if="canvas.mode.value === 'image'" class="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <label class="field-label">
              <span>{{ t('mediaCanvas.size') }}</span>
              <select v-model="canvas.imageSize.value" class="field-control">
                <option>1024x1024</option>
                <option>1024x768</option>
                <option>768x1024</option>
              </select>
            </label>
            <label class="field-label">
              <span>{{ t('mediaCanvas.quality') }}</span>
              <select v-model="canvas.imageQuality.value" class="field-control">
                <option value="auto">{{ t('mediaCanvas.qualityAuto') }}</option>
                <option value="high">{{ t('mediaCanvas.qualityHigh') }}</option>
                <option value="medium">{{ t('mediaCanvas.qualityMedium') }}</option>
                <option value="low">{{ t('mediaCanvas.qualityLow') }}</option>
              </select>
            </label>
            <label class="field-label">
              <span>{{ t('mediaCanvas.count') }}</span>
              <select v-model.number="canvas.imageCount.value" class="field-control">
                <option :value="1">1</option>
                <option :value="2">2</option>
                <option :value="3">3</option>
                <option :value="4">4</option>
              </select>
            </label>
            <label class="field-label">
              <span>{{ t('mediaCanvas.aspectRatio') }}</span>
              <select v-model="canvas.aspectRatio.value" class="field-control">
                <option>1:1</option>
                <option>16:9</option>
                <option>9:16</option>
                <option>4:3</option>
                <option>3:4</option>
              </select>
            </label>
          </div>
          <div v-else class="grid grid-cols-2 gap-4">
            <label class="field-label">
              <span>{{ t('mediaCanvas.duration') }}</span>
              <select v-model.number="canvas.videoDuration.value" class="field-control">
                <option :value="6">{{ t('mediaCanvas.seconds', { count: 6 }) }}</option>
                <option :value="8">{{ t('mediaCanvas.seconds', { count: 8 }) }}</option>
                <option :value="10">{{ t('mediaCanvas.seconds', { count: 10 }) }}</option>
              </select>
            </label>
            <label class="field-label">
              <span>{{ t('mediaCanvas.resolution') }}</span>
              <select v-model="canvas.videoResolution.value" class="field-control">
                <option>480p</option>
                <option>720p</option>
                <option>1080p</option>
              </select>
            </label>
            <label class="field-label sm:col-span-2">
              <span>{{ t('mediaCanvas.aspectRatio') }}</span>
              <select v-model="canvas.aspectRatio.value" class="field-control">
                <option>16:9</option>
                <option>9:16</option>
                <option>1:1</option>
              </select>
            </label>
          </div>

          <p class="rounded-lg border border-indigo-100 bg-indigo-50 px-4 py-3 text-sm text-indigo-950 dark:border-indigo-900 dark:bg-indigo-950/40 dark:text-indigo-100">
            {{ t('mediaCanvas.billingNote') }}
          </p>

          <div v-if="canvas.error.value" role="alert" class="space-y-2 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-300">
            <p>{{ errorText }}</p>
            <p v-if="canvas.errorDetail.value" class="break-words font-normal">{{ canvas.errorDetail.value }}</p>
            <button
              v-if="canvas.error.value === 'loadKeys'"
              type="button"
              class="font-medium underline"
              @click="canvas.loadKeys()"
            >
              {{ t('mediaCanvas.retry') }}
            </button>
            <button
              v-else-if="canvas.error.value === 'loadModels'"
              type="button"
              class="font-medium underline"
              @click="canvas.loadModels()"
            >
              {{ t('mediaCanvas.retry') }}
            </button>
          </div>
          <div class="flex flex-wrap items-center gap-3">
            <button
              type="button"
              class="btn btn-primary min-w-36"
              :disabled="!canvas.canGenerate.value"
              @click="canvas.generate()"
            >
              <span v-if="canvas.busy.value" class="mr-2 inline-block animate-spin" aria-hidden="true">◌</span>
              {{ canvas.busy.value ? t('mediaCanvas.generating') : t('mediaCanvas.generate') }}
            </button>
            <button v-if="canvas.busy.value" type="button" class="btn btn-secondary" @click="canvas.stop()">
              {{ t('mediaCanvas.stop') }}
            </button>
            <span v-if="canvas.status.value !== 'idle'" role="status" class="text-sm text-gray-500 dark:text-gray-400">
              {{ statusText }}
            </span>
          </div>
        </section>

        <section class="card flex min-h-[420px] flex-col p-5 sm:p-6">
          <div class="mb-4 flex items-center justify-between gap-3">
            <h2 class="text-lg font-semibold text-gray-900 dark:text-white">{{ t('mediaCanvas.results') }}</h2>
          </div>
          <div v-if="canvas.results.value.length" class="grid flex-1 content-start gap-4 sm:grid-cols-2">
            <article
              v-for="result in canvas.results.value"
              :key="result.id"
              class="overflow-hidden rounded-xl border border-gray-200 bg-gray-50 dark:border-dark-700 dark:bg-dark-900"
            >
              <img v-if="result.mode === 'image'" :src="result.previewUrl" :alt="result.prompt" class="aspect-square w-full object-contain">
              <video v-else :src="result.previewUrl" class="aspect-video w-full" controls playsinline />
              <div class="space-y-2 p-3">
                <p class="line-clamp-2 text-sm text-gray-800 dark:text-gray-100">{{ result.prompt }}</p>
                <p class="text-xs text-gray-500">{{ result.model }} · {{ result.keyName }}</p>
                <button type="button" class="btn btn-secondary btn-sm" @click="canvas.download(result)">
                  {{ t('mediaCanvas.download') }}
                </button>
              </div>
            </article>
          </div>
          <div v-else class="flex flex-1 items-center justify-center rounded-xl border border-dashed border-gray-300 p-6 text-center text-sm text-gray-500 dark:border-dark-700 dark:text-gray-400">
            {{ t('mediaCanvas.emptyResult') }}
          </div>
        </section>
      </div>

      <section class="card p-5 sm:p-6">
        <div class="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 class="text-lg font-semibold text-gray-900 dark:text-white">{{ t('mediaCanvas.history') }}</h2>
            <p class="mt-1 text-xs text-gray-500 dark:text-gray-400">{{ t('mediaCanvas.historyWarning') }}</p>
          </div>
          <button v-if="canvas.localHistory.value.length" type="button" class="btn btn-secondary btn-sm" @click="clearHistory">
            {{ t('mediaCanvas.clearHistory') }}
          </button>
        </div>
        <p v-if="canvas.loadingHistory.value" role="status" class="rounded-lg bg-gray-50 px-4 py-8 text-center text-sm text-gray-500 dark:bg-dark-900 dark:text-gray-400">
          {{ t('mediaCanvas.loading') }}
        </p>
        <p v-else-if="!canvas.localHistory.value.length" class="rounded-lg bg-gray-50 px-4 py-8 text-center text-sm text-gray-500 dark:bg-dark-900 dark:text-gray-400">
          {{ t('mediaCanvas.emptyHistory') }}
        </p>
        <div v-else class="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <article
            v-for="item in canvas.localHistory.value"
            :key="item.id"
            class="flex min-w-0 items-center gap-3 rounded-xl border border-gray-200 p-3 dark:border-dark-700"
          >
            <img v-if="item.mode === 'image'" :src="item.previewUrl" :alt="item.prompt" class="h-16 w-16 shrink-0 rounded-lg bg-gray-100 object-cover dark:bg-dark-800">
            <video v-else :src="item.previewUrl" class="h-16 w-24 shrink-0 rounded-lg bg-black object-cover" muted playsinline />
            <div class="min-w-0 flex-1">
              <p class="truncate text-sm font-medium text-gray-900 dark:text-white">{{ item.prompt }}</p>
              <p class="truncate text-xs text-gray-500">{{ item.model }} · {{ item.keyName }}</p>
              <p class="text-xs text-gray-400">{{ formatDate(item.createdAt) }}</p>
            </div>
            <div class="flex shrink-0 flex-col gap-2">
              <button type="button" class="text-xs text-indigo-600 hover:underline dark:text-indigo-300" @click="canvas.download(item)">
                {{ t('mediaCanvas.download') }}
              </button>
              <button type="button" class="text-xs text-red-600 hover:underline dark:text-red-400" @click="canvas.deleteLocalRecord(item)">
                {{ t('mediaCanvas.delete') }}
              </button>
            </div>
          </article>
        </div>
      </section>
    </main>
  </AppLayout>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { RouterLink } from 'vue-router'
import { useI18n } from 'vue-i18n'
import AppLayout from '@/components/layout/AppLayout.vue'
import { useAuthStore } from '@/stores/auth'
import { useMediaCanvas } from '@/features/media-canvas/useMediaCanvas'

const { t } = useI18n()
const authStore = useAuthStore()
const canvas = useMediaCanvas(computed(() => authStore.user?.id))
const fileInput = ref<HTMLInputElement | null>(null)
const errorText = computed(() => t('mediaCanvas.errors.' + canvas.error.value))
const statusText = computed(() => {
  const key = canvas.status.value === 'processing' && canvas.progress.value !== null ? 'progress' : canvas.status.value
  return key ? t('mediaCanvas.' + key, { progress: canvas.progress.value ?? 0 }) : ''
})

function onFileChange(event: Event) {
  const input = event.target as HTMLInputElement
  if (!canvas.setUpload(input.files?.[0] || null)) input.value = ''
}

function clearFile() {
  canvas.setUpload(null)
  if (fileInput.value) fileInput.value.value = ''
}

function formatDate(value: number) {
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(value)
}

watch(() => canvas.upload.value, file => {
  if (!file && fileInput.value) fileInput.value.value = ''
})

async function clearHistory() {
  if (!window.confirm(t('mediaCanvas.confirmClear'))) return
  await canvas.clearLocalHistory()
}
</script>

<style scoped>
.canvas-mode { @apply inline-flex items-center gap-2 rounded-lg border border-gray-200 px-4 py-2.5 text-sm font-medium text-gray-600 transition hover:border-indigo-300 dark:border-dark-700 dark:text-gray-300; }
.canvas-mode-active { @apply border-indigo-500 bg-indigo-50 text-indigo-700 shadow-sm dark:border-indigo-400 dark:bg-indigo-950/50 dark:text-indigo-200; }
.field-label { @apply flex min-w-0 flex-col gap-2 text-sm font-medium text-gray-700 dark:text-gray-200; }
.field-control { @apply min-h-10 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 outline-none transition focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 disabled:cursor-not-allowed disabled:bg-gray-100 dark:border-dark-600 dark:bg-dark-800 dark:text-white dark:disabled:bg-dark-900; }
</style>
