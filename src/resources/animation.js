
//Interpolation methods
LS.NONE = 0;
LS.LINEAR = 1;
LS.TRIGONOMETRIC = 2;
LS.BEZIER = 3;
LS.SPLINE = 4;

/**
* An Animation is a resource that contains samples of properties over time, similar to animation curves
* Values could be associated to an specific node.
* Data is contained in tracks
*
* @class Animation
* @namespace LS
* @constructor
*/

function Animation(o)
{
	this.name = "";
	this.takes = {}; //packs of tracks
	if(o)
		this.configure(o);
}

Animation.DEFAULT_SCENE_NAME = "@scene";
Animation.DEFAULT_DURATION = 10;

Animation.prototype.createTake = function( name, duration )
{
	var take = new Animation.Take();
	take.name = name;
	take.duration = duration || 0;
	this.addTake( take );
	return take;
}

Animation.prototype.addTake = function(take)
{
	this.takes[ take.name ] = take;
	return take;
}

Animation.prototype.getTake = function( name )
{
	return this.takes[ name ];
}

Animation.prototype.getNumTakes = function()
{
	var num = 0;
	for(var i in this.takes)
		num++;
	return num;
}


Animation.prototype.addTrackToTake = function(takename, track)
{
	var take = this.takes[ takename ];
	if(!take)
		take = this.createTake( takename );
	take.addTrack( track );
}


Animation.prototype.configure = function(data)
{
	if(data.name)
		this.name = data.name;

	if(data.takes)
	{
		this.takes = {};
		for(var i in data.takes)
		{
			var take = new LS.Animation.Take( data.takes[i] );
			if(!take.name)
				console.warn("Take without name");
			else
			{
				this.addTake( take );
				take.loadResources(); //load associated resources
			}
		}
	}
}

Animation.prototype.serialize = function()
{
	return LS.cloneObject(this, null, true);
}

Animation.fromBinary = function( data )
{
	if(data.constructor == ArrayBuffer)
		data = WBin.load(data, true);

	var o = data["@json"];
	for(var i in o.takes)
	{
		var take = o.takes[i];
		for(var j in take.tracks)
		{
			var track = take.tracks[j];
			var name = "@take_" + i + "_track_" + j;
			if( data[name] )
				track.data = data[name];
		}
	}

	return new LS.Animation( o );
}

Animation.prototype.toBinary = function()
{
	var o = {};
	var tracks_data = [];

	//we need to remove the bin data to generate the JSON
	for(var i in this.takes)
	{
		var take = this.takes[i];
		for(var j in take.tracks)
		{
			var track = take.tracks[j];
			track.packData(); //reduce storage space and speeds up loading

			if(track.packed_data)
			{
				var bindata = track.data;
				var name = "@take_" + i + "_track_" + j;
				o[name] = bindata;
				track.data = null;
				tracks_data.push( bindata );
			}
		}
	}

	//create the binary
	o["@json"] = LS.cloneObject(this, null, true);
	var bin = WBin.create(o, "Animation");

	//restore the bin data state in this instance
	for(var i in this.takes)
	{
		var take = this.takes[i];
		for(var j in take.tracks)
		{
			var track = take.tracks[j];
			var name = "@take_" + i + "_track_" + j;
			if(o[name])
				track.data = o[name];
		}
	}

	return bin;
}

//Used when the animation tracks use UIDs instead of node names
//to convert the track locator to node names, so they can be reused between nodes in the same scene
Animation.prototype.convertIDstoNames = function( use_basename, root )
{
	var num = 0;
	for(var i in this.takes)
	{
		var take = this.takes[i];
		num += take.convertIDstoNames( use_basename, root );
	}
	return num;
}

Animation.prototype.setTracksPacking = function(v)
{
	var num = 0;
	for(var i in this.takes)
	{
		var take = this.takes[i];
		num += take.setTracksPacking(v);
	}
	return num;
}


Animation.prototype.optimizeTracks = function()
{
	var num = 0;
	for(var i in this.takes)
	{
		var take = this.takes[i];
		num += take.optimizeTracks();
	}
	return num;
}


LS.Classes["Animation"] = LS.Animation = Animation;

/**  
* Represents a set of animations
*
* @class Take
* @namespace LS.Animation
* @constructor
*/
function Take(o)
{
	this.name = null;
	this.tracks = [];
	this.duration = LS.Animation.DEFAULT_DURATION;
	
	if(o)
		this.configure(o);

}

Take.prototype.configure = function( o )
{
	if( o.name )
		this.name = o.name;
	if( o.tracks ) 
	{
		this.tracks = []; //clear
		for(var i in o.tracks)
		{
			var track = new LS.Animation.Track( o.tracks[i] );
			this.addTrack( track );
		}
	}
	if( o.duration )
		this.duration = o.duration;
}

Take.prototype.serialize = function()
{
	return LS.cloneObject(this, null, true);
}

Take.prototype.createTrack = function( data )
{
	if(!data)
		throw("Data missing when creating track");

	var track = this.getTrack( data.property );
	if( track )
		return track;

	var track = new LS.Animation.Track( data );
	this.addTrack( track );
	return track;
}

/**
* For every track, gets the interpolated value between keyframes and applies the value to the property associated with the track locator
* Locators are in the form of "{NODE_UID}/{COMPONENT_UID}/{property_name}"
*
* @method applyTracks
* @param {number} current_time the time of the anim to sample
* @param {number} last_time this is used for events, we need to know where you were before
* @param {boolean} ignore_interpolation in case you want to sample the nearest one
* @param {SceneNode} root [Optional] if you want to limit the locator to search inside a node
* @return {Component} the target where the action was performed
*/
Take.prototype.applyTracks = function( current_time, last_time, ignore_interpolation, root_node )
{
	for(var i = 0; i < this.tracks.length; ++i)
	{
		var track = this.tracks[i];
		if( track.enabled === false || !track.data )
			continue;

		//events are an special kind of tracks, they execute actions
		if( track.type == "events" )
		{
			var keyframe = track.getKeyframeByTime( current_time );
			if( !keyframe || keyframe[0] < last_time || keyframe[0] > current_time )
				return;

			//need info to search for node
			var info = LS.GlobalScene.getPropertyInfoFromPath( track._property_path );
			if(!info)
				return;

			var value = keyframe[1];

			if(value[2] == 1) //on function call events the thirth value [2] is 1
			{
				//functions
				if(info.node && info.target && info.target[ value[0] ] )
					info.target[ value[0] ].call( info.target, value[1] );
			}
			else
			{
				//events
				if(info.target) //components
					LEvent.trigger( info.target, keyframe[1], keyframe[1][1] );
				else if(info.node) //nodes
					LEvent.trigger( info.node, keyframe[1][0], keyframe[1][1] );
			}
		}
		else //regular tracks
		{
			//read from the animation track the value
			var sample = track.getSample( current_time, !ignore_interpolation );
			//apply the value to the property specified by the locator
			if( sample !== undefined ) 
				track._target = LS.GlobalScene.setPropertyValueFromPath( track._property_path, sample, root_node, 0 );
		}
	}
}



Take.prototype.addTrack = function( track )
{
	this.tracks.push( track );
}

Take.prototype.getTrack = function( property )
{
	for(var i = 0; i < this.tracks.length; ++i)
		if(this.tracks[i].property == property)
			return this.tracks[i];
	return null;
}

Take.prototype.removeTrack = function( track )
{
	for(var i = 0; i < this.tracks.length; ++i)
		if(this.tracks[i] == track)
		{
			this.tracks.splice( i, 1 );
			return;
		}
}


Take.prototype.getPropertiesSample = function(time, result)
{
	result = result || [];
	for(var i = 0; i < this.tracks.length; ++i)
	{
		var track = this.tracks[i];
		var value = track.getSample( time );
		result.push([track.property, value]);
	}
	return result;
}

Take.prototype.actionPerSample = function(time, callback, options)
{
	for(var i = 0; i < this.tracks.length; ++i)
	{
		var track = this.tracks[i];
		var value = track.getSample(time, true);
		if( options.disabled_tracks && options.disabled_tracks[ track.property ] )
			continue;
		callback(track.property, value, options);
	}
}

//Ensures all the resources associated to keyframes are loaded in memory
Take.prototype.loadResources = function()
{
	for(var i = 0; i < this.tracks.length; ++i)
	{
		var track = this.tracks[i];
		if(track.type == "texture")
		{
			var l = track.getNumberOfKeyframes();
			for(var j = 0; j < l; ++j)
			{
				var keyframe = track.getKeyframe(j);
				if(keyframe && keyframe[1] && keyframe[1][0] != ":")
					LS.ResourcesManager.load( keyframe[1] );
			}
		}
	}
}

//convert track locators from using UIDs to use node names (this way the same animation can be used in several parts of the scene)
Take.prototype.convertIDstoNames = function( use_basename, root )
{
	var num = 0;
	for(var j = 0; j < this.tracks.length; ++j)
	{
		var track = this.tracks[j];
		num += track.convertIDtoName( use_basename, root )
	}
	return num;
}

Take.prototype.setTracksPacking = function(v)
{
	var num = 0;
	for(var i = 0; i < this.tracks.length; ++i)
	{
		var track = this.tracks[i];
		if( track.packed_data == v)
			continue;
		if(v)
			track.packData();
		else
			track.unpackData();
		num += 1;
	}
	return num;
}

//optimize animations
Take.prototype.optimizeTracks = function()
{
	var num = 0;
	var temp = new Float32Array(10);

	for(var i = 0; i < this.tracks.length; ++i)
	{
		var track = this.tracks[i];
		if( track.value_size != 16 )
			continue;

		//convert locator
		var path = track.property.split("/");
		if( path[ path.length - 1 ] != "matrix")
			continue;
		path[ path.length - 1 ] = "Transform/data";
		track.property = path.join("/");
		track.type = "trans10";
		track.value_size = 10;

		//convert samples
		if(!track.packed_data)
		{
			console.warn("convertMatricesToData only works with packed data");
			continue;
		}

		var data = track.data;
		var num_samples = data.length / 17;
		for(var k = 0; k < num_samples; ++k)
		{
			var sample = data.subarray(k*17+1,(k*17)+17);
			var new_data = LS.Transform.fromMatrix4ToTransformData( sample, temp );
			data[k*11] = data[k*17]; //timestamp
			data.set(temp,k*11+1); //overwrite inplace (because the output is less big that the input)
		}
		track.data = new Float32Array( data.subarray(0,num_samples*11) );
		num += 1;
	}
	return num;
}

Take.prototype.matchTranslation = function( root )
{
	var num = 0;

	for(var i = 0; i < this.tracks.length; ++i)
	{
		var track = this.tracks[i];

		if(track.type != "trans10" && track.type != "mat4")
			continue;

		if( !track._property_path || !track._property_path.length )
			continue;

		var node = LSQ.get( track._property_path[0], root );
		if(!node)
			continue;
		
		var position = node.transform.position;
		var offset = track.value_size + 1;

		var data = track.data;
		var num_samples = data.length / offset;
		if(track.type == "trans10")
		{
			for(var j = 0; j < num_samples; ++j)
				data.set( position, j*offset + 1 );
		}
		else if(track.type == "mat4")
		{
			for(var j = 0; j < num_samples; ++j)
				data.set( position, j*offset + 1 + 12 ); //12,13,14 contain translation
		}

		num += 1;
	}

	return num;
}

Take.prototype.onlyRotations = function()
{
	var num = 0;
	var temp = new Float32Array(10);
	var final_quat = temp.subarray(3,7);

	for(var i = 0; i < this.tracks.length; ++i)
	{
		var track = this.tracks[i];

		//convert locator
		var path = track.property.split("/");
		var last_path = path[ path.length - 1 ];
		var old_size = track.value_size;
		if( track.type != "mat4" && track.type != "trans10" )
			continue;

		if(last_path == "matrix")
			path[ path.length - 1 ] = "Transform/rotation";
		else if (last_path == "data")
			path[ path.length - 1 ] = "rotation";

		track.property = path.join("/");
		var old_type = track.type;
		track.type = "quat";
		track.value_size = 4;

		//convert samples
		if(!track.packed_data)
		{
			console.warn("convertMatricesToData only works with packed data");
			continue;
		}

		var data = track.data;
		var num_samples = data.length / (old_size+1);

		if( old_type == "mat4" )
		{
			for(var k = 0; k < num_samples; ++k)
			{
				var sample = data.subarray(k*17+1,(k*17)+17);
				var new_data = LS.Transform.fromMatrix4ToTransformData( sample, temp );
				data[k*11] = data[k*17]; //timestamp
				data.set( final_quat, k*5+1); //overwrite inplace (because the output is less big that the input)
			}
		}
		else if( old_type == "trans10" )
		{
			for(var k = 0; k < num_samples; ++k)
			{
				var sample = data.subarray(k*11+4,(k*11)+8);
				data[k*5] = data[k*11]; //timestamp
				data.set( sample, k*5+1); //overwrite inplace (because the output is less big that the input)
			}
		}
		
		track.data = new Float32Array( data.subarray(0,num_samples*5) );
		num += 1;
	}
	return num;
}


Take.prototype.setInterpolationToAllTracks = function( interpolation )
{
	var num = 0;
	for(var i = 0; i < this.tracks.length; ++i)
	{
		var track = this.tracks[i];
		if(track.interpolation == interpolation)
			continue;
		track.interpolation = interpolation;
		num += 1;
	}

	return num;
}

Animation.Take = Take;


/**
* Represents one track with data over time about one property
* Data could be stored in two forms, or an array containing arrays of [time,data] (unpacked data) or in a single typed array (packed data), depends on the attribute typed_mode
*
* @class Animation.Track
* @namespace LS
* @constructor
*/

function Track(o)
{
	this.enabled = true;
	this.name = ""; //title
	this.type = null; //type of data (number, vec2, color, texture, etc)
	this.interpolation = LS.NONE;
	this.looped = false; //interpolate last keyframe with first

	//data
	this.packed_data = false; //this means the data is stored in one continuous datatype, faster to load but not editable
	this.value_size = 0; //how many numbers contains every sample of this property, 0 means basic type (string, boolean)
	this.data = null; //array or typed array where you have the time value followed by this.value_size bytes of data
	this.data_table = null; //used to index data when storing it

	//to speed up sampling
	Object.defineProperty( this, '_property', {
		value: "",
		enumerable: false,
		writable: true
	});

	Object.defineProperty( this, '_property_path', {
		value: [],
		enumerable: false,
		writable: true
	});

	if(o)
		this.configure(o);
}

Track.FRAMERATE = 30;

//string identifying the property being animated in a locator form ( node/component_uid/property )
Object.defineProperty( Track.prototype, 'property', {
	set: function( property )
	{
		this._property = property.trim();
		this._property_path = this._property.split("/");
	},
	get: function(){
		return this._property;
	},
	enumerable: true
});

Track.prototype.configure = function( o )
{
	if(!o.property)
		console.warn("Track with property name");

	if(o.enabled !== undefined) this.enabled = o.enabled;
	if(o.name) this.name = o.name;
	if(o.property) this.property = o.property;
	if(o.type) this.type = o.type;
	if(o.looped) this.looped = o.looped;
	if(o.interpolation !== undefined)
		this.interpolation = o.interpolation;
	else
		this.interpolation = LS.LINEAR;

	if(o.data_table) this.data_table = o.data_table;

	if(o.value_size) this.value_size = o.value_size;

	//data
	if(o.data)
	{
		this.data = o.data;

		//this is ugly but makes it easy to work with the collada importer
		if(o.packed_data === undefined && this.data.constructor !== Array)
			this.packed_data = true;
		else
			this.packed_data = !!o.packed_data;

		if( o.data.constructor == Array )
		{
			if( this.packed_data )
				this.data = new Float32Array( o.data );
		}
		//else
		//	this.unpackData();
	}

	if(o.interpolation && !this.value_size)
		o.interpolation = LS.NONE;
}

Track.prototype.serialize = function()
{
	var o = {
		enabled: this.enabled,
		name: this.name,
		property: this.property, 
		type: this.type,
		interpolation: this.interpolation,
		looped: this.looped,
		value_size: this.value_size,
		packed_data: this.packed_data,
		data_table: this.data_table
	}

	if(this.data)
	{
		if(this.value_size <= 1)
			o.data = this.data.concat(); //regular array, clone it
		else //pack data
		{
			this.packData();
			o.data = new Float32Array( this.data ); //clone it
			o.packed_data = this.packed_data;
		}
	}

	return o;
}

Track.prototype.toJSON = Track.prototype.serialize;

Track.prototype.clear = function()
{
	this.data = [];
	this.packed_data = false;
}


//used to change every track so instead of using UIDs for properties it uses node names
//this is used when you want to apply the same animation to different nodes in the scene
Track.prototype.convertIDtoName = function( use_basename, root )
{
	if( !this._property_path || !this._property_path.length )
		return false;

	if(this._property_path[0][0] !== LS._uid_prefix)
		return false; //is already using names

	var node = LSQ.get( this._property_path[0], root );
	if(!node)
	{
		console.warn("convertIDtoName: node not found in LS.GlobalScene: " + this._property_path[0] );
		return false;
	}

	if(!node.name)
	{
		console.warn("convertIDtoName: node without name?");
		return false;
	}

	if(use_basename)
	{
		this._property_path[0] = node.name;
		this._property = this._property_path.join("/");
	}
	else
	{
		this._property_path[0] = node.fullname;
		this._property = this._property_path.join("/");
	}

	return true;
}

Track.prototype.addKeyframe = function( time, value, skip_replace )
{
	if(this.value_size > 1)
		value = new Float32Array( value ); //clone

	if(this.packed_data)
		this.unpackData();

	if(!this.data)
		this.data = [];

	for(var i = 0; i < this.data.length; ++i)
	{
		if(this.data[i][0] < time )
			continue;
		if(this.data[i][0] == time && !skip_replace )
			this.data[i][1] = value;
		else
			this.data.splice(i,0, [time,value]);
		return i;
	}

	this.data.push( [time,value] );
	return this.data.length - 1;
}

Track.prototype.getKeyframe = function( index )
{
	if(index < 0 || index >= this.data.length)
	{
		console.warn("keyframe index out of bounds");
		return null;
	}

	if(this.packed_data)
	{
		var pos = index * (1 + this.value_size );
		if(pos > (this.data.length - this.value_size) )
			return null;
		return [ this.data[pos], this.data.subarray(pos+1, pos+this.value_size+1) ];
		//return this.data.subarray(pos, pos+this.value_size+1) ];
	}

	return this.data[ index ];
}

Track.prototype.getKeyframeByTime = function( time )
{
	var index = this.findTimeIndex( time );
	if(index == -1)
		return;
	return this.getKeyframe( index );
}


Track.prototype.moveKeyframe = function(index, new_time)
{
	if(this.packed_data)
	{
		//TODO
		console.warn("Cannot move keyframes if packed");
		return -1;
	}

	if(index < 0 || index >= this.data.length)
	{
		console.warn("keyframe index out of bounds");
		return -1;
	}

	var new_index = this.findTimeIndex( new_time );
	var keyframe = this.data[ index ];
	var old_time = keyframe[0];
	if(old_time == new_time)
		return index;
	keyframe[0] = new_time; //set time
	if(old_time > new_time)
		new_index += 1;
	if(index == new_index)
	{
		//console.warn("same index");
		return index;
	}

	//extract
	this.data.splice(index, 1);
	//reinsert
	index = this.addKeyframe( keyframe[0], keyframe[1], true );

	this.sortKeyframes();
	return index;
}

//solve bugs
Track.prototype.sortKeyframes = function()
{
	if(this.packed_data)
	{
		this.unpackData();
		this.sortKeyframes();
		this.packData();
	}
	this.data.sort( function(a,b){ return a[0] - b[0];  });
}

Track.prototype.removeKeyframe = function(index)
{
	if(this.packed_data)
		this.unpackData();

	if(index < 0 || index >= this.data.length)
	{
		console.warn("keyframe index out of bounds");
		return;
	}

	this.data.splice(index, 1);
}


Track.prototype.getNumberOfKeyframes = function()
{
	if(!this.data || this.data.length == 0)
		return 0;

	if(this.packed_data)
		return this.data.length / (1 + this.value_size );
	return this.data.length;
}

//check for the last sample time
Track.prototype.computeDuration = function()
{
	if(!this.data || this.data.length == 0)
		return 0;

	if(this.packed_data)
	{
		var time = this.data[ this.data.length - 2 - this.value_size ];
		this.duration = time;
		return time;
	}

	//not typed
	var last = this.data[ this.data.length - 1 ];
	if(last)
		return last[0];
	return 0;
}

Track.prototype.isInterpolable = function()
{
	if( this.value_size > 0 || LS.Interpolators[ this.type ] )
		return true;
	return false;
}

//better for reading
Track.prototype.packData = function()
{
	if(!this.data || this.data.length == 0)
		return 0;

	if(this.packed_data)
		return;

	if(this.value_size == 0)
		return; //cannot be packed (bools and strings cannot be packed)

	var offset = this.value_size + 1;
	var data = this.data;
	var typed_data = new Float32Array( data.length * offset );

	for(var i = 0; i < data.length; ++i)
	{
		typed_data[i*offset] = data[i][0];
		if( this.value_size == 1 )
			typed_data[i*offset+1] = data[i][1];
		else
			typed_data.set( data[i][1], i*offset+1 );
	}

	this.data = typed_data;
	this.packed_data = true;
}

//better for writing
Track.prototype.unpackData = function()
{
	if(!this.data || this.data.length == 0)
		return 0;

	if(!this.packed_data)
		return;

	var offset = this.value_size + 1;
	var typed_data = this.data;
	var data = Array( typed_data.length / offset );

	for(var i = 0; i < typed_data.length; i += offset )
		data[i/offset] = [ typed_data[i], typed_data.subarray( i+1, i+offset ) ];

	this.data = data;
	this.packed_data = false;
}

//Dichotimic search
//returns nearest index of keyframe with time equal or less to specified time
Track.prototype.findTimeIndex = function(time)
{
	var data = this.data;
	if(!data || data.length == 0)
		return -1;

	if(this.packed_data)
	{
		var offset = this.value_size + 1; //data size plus timestamp
		var l = data.length;
		var n = l / offset; //num samples
		var imin = 0;
		var imid = 0;
		var imax = n;

		if(n == 0)
			return -1;
		if(n == 1)
			return 0;

		//time out of duration
		if( data[ (imax - 1) * offset ] < time )
			return (imax - 1);

		//dichotimic search
		// continue searching while [imin,imax] are continuous
		while (imax >= imin)
		{
			// calculate the midpoint for roughly equal partition
			imid = ((imax + imin)*0.5)|0;
			var t = data[ imid * offset ]; //get time
			if( t == time )
				return imid; 
			//when there are no more elements to search
			if( imin == (imax - 1) )
				return imin;
			// determine which subarray to search
			if (t < time)
				// change min index to search upper subarray
				imin = imid;
			else         
				// change max index to search lower subarray
				imax = imid;
		}
		return imid;
	}

	//unpacked data
	var n = data.length; //num samples
	var imin = 0;
	var imid = 0;
	var imax = n;

	if(n == 0)
		return -1;
	if(n == 1)
		return 0;

	//time out of duration
	if( data[ (imax - 1) ][0] < time )
		return (imax - 1);

	while (imax >= imin)
	{
		// calculate the midpoint for roughly equal partition
		imid = ((imax + imin)*0.5)|0;
		var t = data[ imid ][0]; //get time
		if( t == time )
			return imid; 
		//when there are no more elements to search
		if( imin == (imax - 1) )
			return imin;
		// determine which subarray to search
		if (t < time)
			// change min index to search upper subarray
			imin = imid;
		else         
			// change max index to search lower subarray
			imax = imid;
	}

	return imid;
}


/*
//Brute force search
Track.prototype.findTimeIndex = function( time )
{
	if(!this.data || this.data.length == 0)
		return -1;

	var data = this.data;
	var l = this.data.length;
	if(!l)
		return -1;
	var i = 0;
	if(this.packed_data)
	{
		var offset = this.value_size + 1;
		var last = -1;
		for(i = 0; i < l; i += offset)
		{
			var current_time = data[i];
			if(current_time < time) 
			{
				last = i;
				continue;
			}
			if(last == -1)
				return -1;
			return (last/offset); //prev sample
		}
		if(last == -1)
			return -1;
		return (last/offset);
	}

	var last = -1;
	for(i = 0; i < l; ++i )
	{
		if(time > data[i][0]) 
		{
			last = i;
			continue;
		}
		if(time == data[i][0]) 
			return i;
		if(last == -1)
			return -1;
		return last;
	}
	if(last == -1)
		return -1;
	return last;
}
*/

//Warning: if no result is provided the same result is reused between samples.
Track.prototype.getSample = function( time, interpolate, result )
{
	if(!this.data || this.data.length === 0)
		return undefined;

	if(this.packed_data)
		return this.getSamplePacked( time, interpolate, result);
	return this.getSampleUnpacked( time, interpolate, result);
}

Track.prototype.getSampleUnpacked = function( time, interpolate, result )
{
	time = Math.clamp( time, 0, this.duration );

	var index = this.findTimeIndex( time );
	if(index === -1)
		index = 0;

	var index_a = index;
	var index_b = index + 1;
	var data = this.data;

	interpolate = interpolate && this.interpolation && (this.value_size > 0 || LS.Interpolators[ this.type ] );

	if(!interpolate || (data.length == 1) || index_b == data.length || (index_a == 0 && this.data[0][0] > time)) //(index_b == this.data.length && !this.looped)
		return this.data[ index ][1];

	var a = data[ index_a ];
	var b = data[ index_b ];

	var t = (b[0] - time) / (b[0] - a[0]);

	if(this.interpolation === LS.LINEAR)
	{
		if(this.value_size === 0 && LS.Interpolators[ this.type ] )
		{
			var func = LS.Interpolators[ this.type ];
			var r = func( a[1], b[1], t, this._last_value );
			this._last_value = r;
			return r;
		}

		if(this.value_size == 1)
			return a[1] * t + b[1] * (1-t);

		result = result || this._result;

		if(!result || result.length != this.value_size)
			result = this._result = new Float32Array( this.value_size );

		switch(this.type)
		{
			case "quat": 
				quat.slerp( result, a[1], b[1], t );
				quat.normalize( result, result );
				break;
			case "trans10": 
				for(var i = 0; i < 10; i++) //this.value_size should be 10
					result[i] = a[1][i] * t + b[1][i] * (1-t);
				var rotA = a[1].subarray(3,7);
				var rotB = b[1].subarray(3,7);
				var rotR = result.subarray(3,7);
				quat.slerp( rotR, rotB, rotA, t );
				quat.normalize( rotR, rotR );
				break;
			default:
				for(var i = 0; i < this.value_size; i++)
					result[i] = a[1][i] * t + b[1][i] * (1-t);
		}

		return result;
	}
	else if(this.interpolation === LS.BEZIER)
	{
		//bezier not implemented for interpolators
		if(this.value_size === 0 && LS.Interpolators[ this.type ] )
		{
			var func = LS.Interpolators[ this.type ];
			var r = func( a[1], b[1], t, this._last_value );
			this._last_value = r;
			return r;
		}

		var pre_a = index > 0 ? data[ index - 1 ] : a;
		var post_b = index < data.length - 2 ? data[ index + 2 ] : b;

		if(this.value_size === 1)
			return Animation.EvaluateHermiteSpline(a[1],b[1],pre_a[1],post_b[1], 1 - t );


		result = result || this._result;

		//multiple data
		if(!result || result.length != this.value_size)
			result = this._result = new Float32Array( this.value_size );

		result = result || this._result;
		result = Animation.EvaluateHermiteSplineVector(a[1],b[1], pre_a[1], post_b[1], 1 - t, result );

		if(this.type == "quat")
			quat.normalize(result, result);
		else if(this.type == "trans10")
		{
			var rot = result.subarray(3,7);
			quat.normalize(rot, rot);
		}

		return result;
	}

	return null;
}

Track.prototype.getSamplePacked = function( time, interpolate, result )
{
	time = Math.clamp( time, 0, this.duration );

	var index = this.findTimeIndex( time );
	if(index == -1)
		index = 0;

	var offset = (this.value_size+1);
	var index_a = index;
	var index_b = index + 1;
	var data = this.data;
	var num_keyframes = data.length / offset;

	interpolate = interpolate && this.interpolation && (this.value_size > 0 || LS.Interpolators[ this.type ] );

	if( !interpolate || num_keyframes == 1 || index_b == num_keyframes || (index_a == 0 && this.data[0] > time)) //(index_b == this.data.length && !this.looped)
		return this.getKeyframe( index )[1];

	var a = data.subarray( index_a * offset, (index_a + 1) * offset );
	var b = data.subarray( index_b * offset, (index_b + 1) * offset );

	var t = (b[0] - time) / (b[0] - a[0]);

	if(this.interpolation === LS.LINEAR)
	{
		if(this.value_size == 1)
			return a[1] * t + b[1] * (1-t);
		else if( LS.Interpolators[ this.type ] )
		{
			var func = LS.Interpolators[ this.type ];
			var r = func( a[1], b[1], t, this._last_v );
			this._last_v = r;
			return r;
		}

		result = result || this._result;

		if(!result || result.length != this.value_size)
			result = this._result = new Float32Array( this.value_size );

		switch(this.type)
		{
			case "quat": 
				quat.slerp( result, b.subarray(1,5), a.subarray(1,5), t );
				quat.normalize( result, result );
				break;
			case "trans10": 
				for(var i = 0; i < 10; i++) //this.value_size should be 10
					result[i] = a[1+i] * t + b[1+i] * (1-t);
				var rotA = a.subarray(4,8);
				var rotB = b.subarray(4,8);
				var rotR = result.subarray(3,7);
				quat.slerp( rotR, rotB, rotA, t );
				quat.normalize( rotR, rotR );
				break;
			default:
				for(var i = 0; i < this.value_size; i++)
					result[i] = a[1+i] * t + b[1+i] * (1-t);
		}

		return result;
	}
	else if(this.interpolation === LS.BEZIER)
	{
		if( this.value_size === 0) //bezier not supported in interpolators
			return a[1];

		var pre_a = index > 0 ? data.subarray( (index-1) * offset, (index) * offset ) : a;
		var post_b = index_b < (num_keyframes - 1) ? data.subarray( (index_b+1) * offset, (index_b+2) * offset ) : b;

		if(this.value_size === 1)
			return Animation.EvaluateHermiteSpline( a[1], b[1], pre_a[1], post_b[1], 1 - t );

		result = result || this._result;

		//multiple data
		if(!result || result.length != this.value_size)
			result = this._result = new Float32Array( this.value_size );

		result = result || this._result;
		result = Animation.EvaluateHermiteSplineVector( a.subarray(1,offset), b.subarray(1,offset), pre_a.subarray(1,offset), post_b.subarray(1,offset), 1 - t, result );

		if(this.type == "quat")
			quat.normalize(result, result);
		else if(this.type == "trans10")
		{
			var rot = result.subarray(3,7);
			quat.normalize(rot, rot);
		}

		return result;
	}

	return null;
}


Track.prototype.getPropertyInfo = function()
{
	return LS.GlobalScene.getPropertyInfo( this.property );
}

Track.prototype.getSampledData = function( start_time, end_time, num_samples )
{
	var delta = (end_time - start_time) / num_samples;
	if(delta <= 0)
		return null;

	var samples = [];
	for(var i = 0; i < num_samples; ++i)
	{
		var t = i * delta + start_time;
		var sample = this.getSample( t, true );
		if(this.value_size > 1)
			sample = new sample.constructor( sample );
		samples.push(sample);
	}

	return samples;
}


Animation.Track = Track;

/*
vec3f EvaluateHermiteSpline(const vec3f& p0, const vec3f& p1, const vec3f& t0, const vec3f& t1, float s)
{
	float s2 = s * s;
	float s3 = s2 * s;
	float h1 =  2*s3 - 3*s2 + 1;          // calculate basis function 1
	float h2 = -2*s3 + 3*s2;              // calculate basis function 2
	float h3 =   s3 - 2*s2 + s;         // calculate basis function 3
	float h4 =   s3 -  s2;              // calculate basis function 4
	vec3f p = h1*p0+                    // multiply and sum all funtions
						 h2*p1 +                    // together to build the interpolated
						 h3*t0 +                    // point along the curve.
						 h4*t1;
	return p;
}
*/


Animation.EvaluateHermiteSpline = function( p0, p1, pre_p0, post_p1, s )
{
	var s2 = s * s;
	var s3 = s2 * s;
	var h1 =  2*s3 - 3*s2 + 1;          // calculate basis function 1
	var h2 = -2*s3 + 3*s2;              // calculate basis function 2
	var h3 =   s3 - 2*s2 + s;         // calculate basis function 3
	var h4 =   s3 -  s2;              // calculate basis function 4
	
	var t0 = p1 - pre_p0;
	var t1 = post_p1 - p0;

	return h1 * p0 + h2 * p1 + h3 * t0 + h4 * t1;
}

Animation.EvaluateHermiteSplineVector = function( p0, p1, pre_p0, post_p1, s, result )
{
	result = result || new Float32Array( result.length );

	var s2 = s * s;
	var s3 = s2 * s;
	var h1 =  2*s3 - 3*s2 + 1;          // calculate basis function 1
	var h2 = -2*s3 + 3*s2;              // calculate basis function 2
	var h3 =   s3 - 2*s2 + s;         // calculate basis function 3
	var h4 =   s3 -  s2;              // calculate basis function 4

	for(var i = 0; i < result.length; ++i)
	{
		var t0 = p1[i] - pre_p0[i];
		var t1 = post_p1[i] - p0[i];
		result[i] = h1 * p0[i] + h2 * p1[i] + h3 * t0 + h4 * t1;
	}

	return result;
}


LS.registerResourceClass( Animation );


LS.Interpolators = {};

LS.Interpolators["texture"] = function( a, b, t, last )
{
	var texture_a = a ? LS.getTexture( a ) : null;
	var texture_b = b ? LS.getTexture( b ) : null;

	if(a && !texture_a && a[0] != ":" )
		LS.ResourcesManager.load(a);
	if(b && !texture_b && b[0] != ":" )
		LS.ResourcesManager.load(b);

	var texture = texture_a || texture_b;

	var black = gl.textures[":black"];
	if(!black)
		black = gl.textures[":black"] = new GL.Texture(1,1, { format: gl.RGB, pixel_data: [0,0,0], filter: gl.NEAREST });

	if(!texture)
		return black;

	var w = texture ? texture.width : 256;
	var h = texture ? texture.height : 256;

	if(!texture_a)
		texture_a = black;
	if(!texture_b)
		texture_b = black;

	if(!last || last.width != w || last.height != h || last.format != texture.format )
		last = new GL.Texture( w, h, { format: texture.format, type: texture.type, filter: gl.LINEAR } );

	var shader = gl.shaders[":interpolate_texture"];
	if(!shader)
		shader = gl.shaders[":interpolate_texture"] = GL.Shader.createFX("color = mix( texture2D( u_texture_b, uv ), color , u_factor );", "uniform sampler2D u_texture_b; uniform float u_factor;" );

	gl.disable( gl.DEPTH_TEST );
	last.drawTo( function() {
		gl.clearColor(0,0,0,0);
		gl.clear( gl.COLOR_BUFFER_BIT );
		texture_b.bind(1);
		texture_a.toViewport( shader, { u_texture_b: 1, u_factor: t } );
	});

	return last;
}
