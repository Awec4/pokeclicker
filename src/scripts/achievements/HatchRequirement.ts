///<reference path="Requirement.ts"/>

class HatchRequirement extends Requirement {
    constructor(value: number, option: GameConstants.AchievementOption = GameConstants.AchievementOption.more) {
        super(value, option, GameConstants.AchievementType['Hatch']);
    }

    public getProgress() {
        return Math.min(App.game.statistics.totalPokemonHatched(), this.requiredValue);
    }

    public hint(): string {
        return `${this.requiredValue} eggs need to be hatched.`;
    }
}
