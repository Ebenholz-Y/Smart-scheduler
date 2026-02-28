class GeneticScheduler {
    constructor(params) {
        this.populationSize = params.populationSize || 50;
        this.generations = params.generations || 100;
        this.mutationRate = params.mutationRate || 0.1;
        this.crossoverRate = params.crossoverRate || 0.8;
        this.timeSlots = Array.from({length: 10}, (_, i) => i + 1);
        this.weekdays = ['周一', '周二', '周三', '周四', '周五'];
        this.scheduleSlots = [];
        this.weekdays.forEach(day => {
            this.timeSlots.forEach(time => {
                this.scheduleSlots.push(`${day} 第${time}节`);
            });
        });
    }

    generateInitialPopulation(courses, classrooms) {
        const population = [];
        for (let i = 0; i < this.populationSize; i++) {
            const chromosome = [];
            courses.forEach(course => {
                const randomSlot = this.scheduleSlots[Math.floor(Math.random() * this.scheduleSlots.length)];
                const classroom = classrooms[Math.floor(Math.random() * classrooms.length)];
                chromosome.push({
                    course: course,
                    time: randomSlot,
                    classroom: classroom
                });
            });
            population.push(chromosome);
        }
        return population;
    }

    calculateFitness(chromosome) {
        let fitness = 0;
        const teacherSchedule = {};
        const classroomSchedule = {};
        const studentConflict = {};

        chromosome.forEach(schedule => {
            const { course, time, classroom } = schedule;
            const teacher = course.teacher;

            if (!teacherSchedule[teacher]) teacherSchedule[teacher] = [];
            if (teacherSchedule[teacher].includes(time)) {
                fitness -= 100;
            } else {
                teacherSchedule[teacher].push(time);
            }

            if (!classroomSchedule[classroom.id]) classroomSchedule[classroom.id] = [];
            if (classroomSchedule[classroom.id].includes(time)) {
                fitness -= 100;
            } else {
                classroomSchedule[classroom.id].push(time);
            }

            if (course.students > classroom.capacity) {
                fitness -= 50;
            } else {
                fitness += 10;
            }

            const classKey = `class_${course.name}`;
            if (!studentConflict[classKey]) studentConflict[classKey] = [];
            if (studentConflict[classKey].includes(time)) {
                fitness -= 50;
            } else {
                studentConflict[classKey].push(time);
            }
        });

        fitness += chromosome.length * 10;
        return Math.max(0, fitness);
    }

    selection(population) {
        const fitnesses = population.map(ind => this.calculateFitness(ind));
        const totalFitness = fitnesses.reduce((a, b) => a + b, 0);

        if (totalFitness === 0) {
            return population[Math.floor(Math.random() * population.length)];
        }

        let rand = Math.random() * totalFitness;
        for (let i = 0; i < population.length; i++) {
            rand -= fitnesses[i];
            if (rand <= 0) {
                return population[i];
            }
        }
        return population[0];
    }

    crossover(parent1, parent2) {
        if (Math.random() > this.crossoverRate) {
            return parent1.slice();
        }
        const crossoverPoint = Math.floor(Math.random() * parent1.length);
        const child = [];
        for (let i = 0; i < parent1.length; i++) {
            if (i < crossoverPoint) {
                child.push({...parent1[i]});
            } else {
                child.push({...parent2[i]});
            }
        }
        return child;
    }

    mutate(chromosome, classrooms) {
        for (let i = 0; i < chromosome.length; i++) {
            if (Math.random() < this.mutationRate) {
                if (Math.random() < 0.5) {
                    chromosome[i].time = this.scheduleSlots[Math.floor(Math.random() * this.scheduleSlots.length)];
                } else {
                    chromosome[i].classroom = classrooms[Math.floor(Math.random() * classrooms.length)];
                }
            }
        }
        return chromosome;
    }

    async run(courses, classrooms) {
        return new Promise((resolve) => {
            const population = this.generateInitialPopulation(courses, classrooms);
            let bestFitness = 0;
            let bestSchedule = null;

            for (let gen = 0; gen < this.generations; gen++) {
                const fitnesses = population.map(ind => this.calculateFitness(ind));
                const maxFitness = Math.max(...fitnesses);

                if (maxFitness > bestFitness) {
                    bestFitness = maxFitness;
                    bestSchedule = population[fitnesses.indexOf(maxFitness)];
                }

                const newPopulation = [];
                for (let i = 0; i < this.populationSize; i++) {
                    const parent1 = this.selection(population);
                    const parent2 = this.selection(population);
                    let child = this.crossover(parent1, parent2);
                    child = this.mutate(child, classrooms);
                    newPopulation.push(child);
                }

                for (let i = 0; i < this.populationSize; i++) {
                    population[i] = newPopulation[i];
                }
            }

            resolve({
                schedule: bestSchedule,
                fitness: bestFitness
            });
        });
    }
}

module.exports = { GeneticScheduler };