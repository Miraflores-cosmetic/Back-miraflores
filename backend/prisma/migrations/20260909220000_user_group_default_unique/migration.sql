-- At most one default guest group and one default registered group.
CREATE UNIQUE INDEX "UserGroup_isDefaultGuest_key" ON "UserGroup"("isDefaultGuest") WHERE "isDefaultGuest" = true;
CREATE UNIQUE INDEX "UserGroup_isDefaultRegistered_key" ON "UserGroup"("isDefaultRegistered") WHERE "isDefaultRegistered" = true;
