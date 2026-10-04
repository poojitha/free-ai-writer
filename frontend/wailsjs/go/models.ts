export namespace main {
	
	export class OllamaSettings {
	    host: string;
	    model: string;
	    prompt: string;
	
	    static createFrom(source: any = {}) {
	        return new OllamaSettings(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.host = source["host"];
	        this.model = source["model"];
	        this.prompt = source["prompt"];
	    }
	}

}

