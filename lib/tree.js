'use strict';
const Schema = require('mongoose').Schema;

function getModel(root) {
  const modelName = root.constructor.baseModelName || root.constructor.modelName;
  return root.model(modelName);
}

const PATH_SEPARATOR = '#';
const PATH_SEPARATOR_REGEX = `[${PATH_SEPARATOR}]`;

/**
 * @class Tree
 * Tree Behavior for Mongoose
 *
 * Implements the materialized path strategy with cascade child re-parenting
 * on delete for storing a hierarchy of documents with Mongoose
 *
 * @param  {Mongoose.Schema} schema
 * @param  {Object} options
 */
function tree(schema) {
  /**
   * Add parent and path properties
   *
   * @property {ObjectID} parent
   * @property {String} path
   */
  schema.add({
    parent: {
      type: Schema.ObjectId,
      set(val) {
        if (val instanceof Object && val._id) {
          if (val.path) {
            this.path = `${val.path}${PATH_SEPARATOR}${this._id.toString()}`;
          }
          return val._id;
        } else {
          return val;
        }
      }
    },
    path: {
      type: String
    }
  });


  /**
   * Pre-save middleware
   * Build or rebuild path when needed
   */
  schema.pre('save', async function preSave() {
    const isParentChange = this.isModified('parent');

    if (!this.isNew && !isParentChange) {
      return;
    }

    if (!this.parent) {
      this.path = this._id.toString();
      return;
    }

    if (this.isNew && this.path) {
      return;
    }

    const parent = await this.collection.findOne({ _id: this.parent }, { _id: 0, path: 1 });
    this.path = `${parent.path}${PATH_SEPARATOR}${this._id.toString()}`;
  });

  /**
   * Pre-remove middleware
   */
  schema.pre('remove', async function preRemove() {
    if (!this.path) {
      return;
    }

    await this.collection.deleteMany({ path: { $regex: `^${this.path}${PATH_SEPARATOR_REGEX}` } });
  });

  /**
   * @method getChildren
   *
   *         {Object}        filters (like for mongo find) (optional)
   *  {Object} or {String}   fields  (like for mongo find) (optional)
   *         {Object}        options (like for mongo find) (optional)
   * @param  {Boolean}       recursive, default false      (optional)
   * @return {Model}
   */
  schema.methods.getChildren = async function getChildren(filters = {}, fields = null, options = {}, recursive = false) {
    if (recursive) {
      if(filters.$query){
        filters.$query.path = { $regex: `^${this.path}${PATH_SEPARATOR_REGEX}` };
      } else {
        filters.path = { $regex: `^${this.path}${PATH_SEPARATOR_REGEX}` };
      }
    } else if (filters.$query) {
      filters.$query.parent = this._id;
    } else {
      filters.parent = this._id;
    }

    return await getModel(this).find(filters, fields, options).exec();
  };

  /**
   * @method getParent
   *
   * @return {Model}
   */
  schema.methods.getParent = async function getParent() {
    return await getModel(this).findOne({ _id: this.parent }).exec();
  };

  /**
   * @method getAncestors
   *
   * @param  {Object}   args
   * @return {Model}
   */
  schema.methods.getAncestors = async function getAncestors(filters = {}, fields = null, options = {}) {
    let ids = [];

    if (this.path) {
      ids = this.path.split(PATH_SEPARATOR);
      ids.pop();
    }

    if(filters.$query){
      filters.$query._id = { $in: ids };
    } else {
      filters._id = { $in: ids };
    }

    return await getModel(this).find(filters, fields, options).exec();
  };

  /**
   * @property {Number} level <virtual>
   */
  schema.virtual('level').get(function virtualPropLevel() {
    return this.path?.split(PATH_SEPARATOR).length ?? 0;
  });
}

module.exports = exports = tree;
