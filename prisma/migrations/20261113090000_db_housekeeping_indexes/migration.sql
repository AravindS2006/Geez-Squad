-- CreateIndex
CREATE INDEX "ClassSession_studioId_status_startsAt_idx" ON "ClassSession"("studioId", "status", "startsAt");

-- CreateIndex
CREATE INDEX "ClassSession_hostId_status_startsAt_idx" ON "ClassSession"("hostId", "status", "startsAt");

-- CreateIndex
CREATE INDEX "ClassSession_status_startedAt_idx" ON "ClassSession"("status", "startedAt");

-- CreateIndex
CREATE INDEX "WebhookEvent_createdAt_idx" ON "WebhookEvent"("createdAt");

-- CreateIndex
CREATE INDEX "AuditEvent_targetId_createdAt_idx" ON "AuditEvent"("targetId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditEvent_createdAt_idx" ON "AuditEvent"("createdAt");

