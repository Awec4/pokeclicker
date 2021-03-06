/// <reference path="../../declarations/GameHelper.d.ts" />
/// <reference path="../../declarations/DataStore/common/Saveable.d.ts" />

class Quests implements Saveable {
    saveKey = 'quests';

    defaults = {
        xp: 0,
        refreshes: 0,
        freeRefresh: false,
    };

    public xp = ko.observable(0).extend({ numeric: 0 });
    public refreshes = ko.observable(0);
    public lastRefresh = new Date();
    public lastRefreshLevel = 0;
    public freeRefresh = ko.observable(false);
    public questList: KnockoutObservableArray<Quest> = ko.observableArray();
    public questLines: KnockoutObservableArray<QuestLine> = ko.observableArray();
    public level: KnockoutComputed<number> = ko.pureComputed((): number => {
        return this.xpToLevel(this.xp());
    });
    public questSlots: KnockoutComputed<number> = ko.pureComputed((): number => {
        // Minimum of 1, Maximum of 4
        return Math.min(4, Math.max(1, Math.floor(this.level() / 5)));
    });

    // Get current quests by status
    public completedQuests: KnockoutComputed<Array<Quest>> = ko.pureComputed(() => {
        return this.questList().filter(quest => quest.isCompleted());
    });
    public currentQuests: KnockoutComputed<Array<Quest>> = ko.pureComputed(() => {
        return this.questList().filter(quest => quest.inProgress() && !quest.claimed());
    });
    public incompleteQuests: KnockoutComputed<Array<Quest>> =  ko.pureComputed(() => {
        return this.questList().filter(quest => !quest.isCompleted());
    });

    constructor() {}

    // Get a quest line by name
    getQuestLine(name) {
        return this.questLines().find(ql => ql.name.toLowerCase() == name.toLowerCase());
    }

    public beginQuest(index: number) {
        const quest  = this.questList()[index];
        // Check if we can start a new quest, and the requested quest isn't started or completed
        if (this.canStartNewQuest() && quest && !quest.inProgress() && !quest.isCompleted()) {
            quest.begin();
        } else {
            Notifier.notify({
                message: 'You cannot start more quests',
                type: NotificationConstants.NotificationOption.danger,
            });
        }
    }

    public quitQuest(index: number, shouldConfirm = false) {
        // Check if we can quit this quest
        const quest  = this.questList()[index];
        if (quest && quest.inProgress()) {
            quest.quit(shouldConfirm);
        } else {
            Notifier.notify({
                message: 'You cannot quit this quest',
                type: NotificationConstants.NotificationOption.danger,
            });
        }
    }

    public claimQuest(index: number) {
        // Check if we can claim this quest
        const quest  = this.questList()[index];
        if (quest && quest.isCompleted() && !quest.claimed()) {
            quest.claim();
            // Once the player completes every available quest, refresh the list for free
            if (this.allQuestClaimed()) {
                this.refreshQuests(true);
                // Give player a free refresh
                this.freeRefresh(true);
            }
        } else {
            console.trace('cannot claim quest..');
            Notifier.notify({
                message: 'You cannot claim this quest',
                type: NotificationConstants.NotificationOption.danger,
            });
        }
    }

    public addXP(amount) {
        if (isNaN(amount)) {
            return;
        }
        const currentLevel = this.level();
        GameHelper.incrementObservable(this.xp, amount);

        // Refresh the list each time a player levels up
        if (this.level() > currentLevel) {
            Notifier.notify({
                message: 'Your quest level has increased!<br/><i>You have a free quest refresh.</i>',
                type: NotificationConstants.NotificationOption.success,
                timeout: 1e4,
                sound: NotificationConstants.NotificationSound.quest_level_increased,
            });
            this.freeRefresh(true);
        }
    }

    generateQuestList(date = new Date(), level = this.level()) {
        if (this.lastRefresh.toDateString() != date.toDateString()) {
            this.refreshes(0);
        }
        this.lastRefresh = date;
        this.lastRefreshLevel = level;
        this.currentQuests().forEach(quest => quest.quit());
        this.questList(QuestHelper.generateQuestList(this.generateSeed(date, level), GameConstants.QUESTS_PER_SET));
    }

    private generateSeed(date = new Date(), level = this.level()): number {
        return Number(level * (date.getFullYear() + this.refreshes() * 10) * date.getDate() + 1000 * date.getMonth() + 100000 * date.getDate());
    }

    public refreshQuests(free = this.freeRefresh(), shouldConfirm = false) {
        if (free || this.canAffordRefresh()) {
            if (!free) {
                if (shouldConfirm && !confirm('Are you sure you want to refresh the quest list?!')) {
                    return;
                }
                App.game.wallet.loseAmount(this.getRefreshCost());
            }
            this.freeRefresh(false);
            GameHelper.incrementObservable(this.refreshes);
            this.generateQuestList();
        } else {
            Notifier.notify({
                message: 'You cannot afford to do that!',
                type: NotificationConstants.NotificationOption.danger,
            });
        }
    }

    public resetRefreshes() {
        this.refreshes(0);
    }

    public canAffordRefresh(): boolean {
        return App.game.wallet.hasAmount(this.getRefreshCost());
    }

    // Returns 0 when all quests are complete, ~1 million when none are
    public getRefreshCost(): Amount {
        // If we have a free refersh, just assume all the quest are completed
        const notComplete = this.freeRefresh() ? 0 : this.incompleteQuests().length;
        const cost = Math.floor((250000 * Math.LOG10E * Math.log(Math.pow(notComplete, 4) + 1)) / 1000) * 1000;
        return new Amount(Math.max(0, Math.min(1e6, cost)), GameConstants.Currency.money);
    }

    public canStartNewQuest(): boolean {
        // Check we haven't already used up all quest slots
        if (this.currentQuests().length >= this.questSlots()) {
            return false;
        }

        // Check at least 1 quest is either not completed or in progress
        if (this.questList().find(quest => !quest.isCompleted() && !quest.inProgress())) {
            return true;
        }

        return false;
    }

    // returns false if we still have incomplete/inprogress quest
    public allQuestClaimed() {
        return !this.incompleteQuests().length && !this.currentQuests().length;
    }

    // 1000 xp needed to reach level 2, amount needed for next level increases by 20% of previous level
    public levelToXP(level: number): number {
        if (level >= 2) {
            // Sum of geometric series
            const a = 1000, r = 1.2, n = level - 1;
            const sum = a * (Math.pow(r, n) - 1) / (r - 1);
            return Math.ceil(sum);
        } else {
            return 0;
        }
    }

    public xpToLevel(xp: number): number {
        const sum = xp, a = 1000, r = 1.2;
        const n = Math.log(1 + ((r - 1) * sum) / a) / Math.log(r);
        return Math.floor(n + 1);
    }

    public percentToNextQuestLevel(): number {
        const current = this.level();
        const requiredForCurrent = this.levelToXP(current);
        const requiredForNext = this.levelToXP(current + 1);
        return 100 * (this.xp() - requiredForCurrent) / (requiredForNext - requiredForCurrent);
    }

    loadQuestList(questList) {
        questList.forEach(quest => {
            if (quest.initial === null) {
                return;
            }
            this.questList()[quest.index].notified = quest.notified;
            this.questList()[quest.index].claimed(quest.claimed);
            this.questList()[quest.index].initial(quest.initial);
        });
    }

    loadQuestLines(questLines) {
        questLines.forEach(questLine => {
            if (questLine.state == QuestLineState.inactive) {
                return;
            }
            const ql = this.questLines().find(ql => ql.name == questLine.name);
            if (ql) {
                ql.state(questLine.state);
                if (questLine.state == QuestLineState.started) {
                    ql.resumeAt(questLine.quest, questLine.initial);
                }
            }
        });
    }

    toJSON() {
        return {
            xp: this.xp(),
            refreshes: this.refreshes(),
            lastRefresh: this.lastRefresh,
            lastRefreshLevel: this.lastRefreshLevel,
            freeRefresh: this.freeRefresh(),
            questList: this.questList(),
            questLines: this.questLines(),
        };
    }

    fromJSON(json: any) {
        if (!json) {
            // Generate the questList
            this.generateQuestList();
            // Generate the questLines
            QuestLineHelper.loadQuestLines();
            return;
        }

        this.xp(json.xp || this.defaults.xp);
        this.refreshes(json.refreshes || this.defaults.refreshes);
        this.lastRefresh = json.lastRefresh ? new Date(json.lastRefresh) : new Date();
        this.lastRefreshLevel = json.lastRefreshLevel || this.level();
        if (this.lastRefresh.toDateString() != new Date().toDateString()) {
            this.freeRefresh(true);
        } else {
            this.freeRefresh(json.freeRefresh || this.defaults.freeRefresh);
        }

        // Generate quest list
        this.generateQuestList(this.lastRefresh, this.lastRefreshLevel);
        // Load our current quest list
        if (json.questList) {
            this.loadQuestList(json.questList);
        }

        // Generate the questLines
        QuestLineHelper.loadQuestLines();
        // Load our quest line quest
        if (json.questLines) {
            this.loadQuestLines(json.questLines);
        }
    }
}
